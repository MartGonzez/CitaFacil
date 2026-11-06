import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

let currentTenant = null;
let selectedService = null;
let selectedSlot = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Obtener el slug desde la URL (query parameter ?b= o path)
    const urlParams = new URLSearchParams(window.location.search);
    let slug = urlParams.get('b');

    if (!slug) {
        const pathSegments = window.location.pathname.split('/').filter(p => p);
        if (pathSegments.length > 0 && pathSegments[0] !== 'agenda.html') {
            slug = pathSegments[0];
        }
    }

    if (!slug) slug = 'barberia-demo';

    // 2. Configurar fecha por defecto (Hoy) y fecha mínima
    const dateInput = document.getElementById('booking-date');
    const today = new Date().toISOString().split('T')[0];
    if (dateInput) {
        dateInput.min = today;
        dateInput.value = today; // Marca automáticamente la fecha actual

        dateInput.addEventListener('change', (e) => {
            loadAvailableSlots(e.target.value);
        });
    }

    // 3. Listener del formulario
    const form = document.getElementById('booking-form');
    if (form) {
        form.addEventListener('submit', handleBookingSubmit);
    }

    // 4. Cargar datos del negocio
    await loadTenantData(slug);
});

async function loadTenantData(slug) {
    const nameEl = document.getElementById('business-name');
    const addressEl = document.getElementById('business-address');
    const descEl = document.getElementById('business-description');
    const servicesContainer = document.getElementById('services-container');

    try {
        const q = query(collection(db, "tenants"), where("slug", "==", slug));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            nameEl.textContent = "Negocio no encontrado";
            addressEl.textContent = "📍 Revisa el enlace ingresado";
            servicesContainer.innerHTML = `<p class="info-text">No existe ningún negocio registrado con el slug: <strong>${slug}</strong>.</p>`;
            return;
        }

        const tenantDoc = querySnapshot.docs[0];
        currentTenant = { id: tenantDoc.id, ...tenantDoc.data() };

        // Renderizar mini-landing del negocio
        nameEl.textContent = currentTenant.name || 'Agenda de Citas';
        addressEl.textContent = currentTenant.address ? `📍 ${currentTenant.address}` : '📍 Santiago, Chile';
        if (descEl) {
            descEl.textContent = currentTenant.description || 'Bienvenido a nuestra agenda online. Reserva tu hora en segundos.';
        }

        // Logo o Emoji
        if (currentTenant.logoUrl || currentTenant.icon) {
            const logoEl = document.getElementById('business-logo');
            const logoSrc = currentTenant.logoUrl || currentTenant.icon;
            if (logoSrc.startsWith('http')) {
                logoEl.innerHTML = `<img src="${logoSrc}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            } else {
                logoEl.textContent = logoSrc;
            }
        }

        // Banner de portada
        if (currentTenant.coverUrl) {
            document.getElementById('hero-banner').style.backgroundImage = `url('${currentTenant.coverUrl}')`;
        }

        // Galería de fotos
        if (currentTenant.photos && currentTenant.photos.length > 0) {
            const galleryGrid = document.getElementById('gallery-grid');
            if (galleryGrid) {
                galleryGrid.innerHTML = '';
                currentTenant.photos.forEach(url => {
                    if (url.trim()) {
                        const img = document.createElement('img');
                        img.src = url.trim();
                        galleryGrid.appendChild(img);
                    }
                });
                document.getElementById('gallery-section').classList.remove('hidden');
            }
        }

        // Instagram
        if (currentTenant.instagram) {
            const socialEl = document.getElementById('social-links');
            if (socialEl) {
                socialEl.innerHTML = `<a href="https://instagram.com/${currentTenant.instagram}" target="_blank">📸 @${currentTenant.instagram}</a>`;
            }
        }

        // Cargar servicios
        await loadServices(tenantDoc.id);

        // Cargar automáticamente los horarios de hoy al abrir la página
        const dateInput = document.getElementById('booking-date');
        const selectedDate = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
        await loadAvailableSlots(selectedDate);

    } catch (error) {
        console.error("Error al cargar negocio:", error);
        nameEl.textContent = "Error de conexión";
        addressEl.textContent = "📍 Error con Firebase";
        servicesContainer.innerHTML = `<p class="info-text" style="color:red;">No se pudieron cargar los datos.</p>`;
    }
}

async function loadServices(tenantId) {
    const servicesContainer = document.getElementById('services-container');
    servicesContainer.innerHTML = '';

    try {
        const servicesSnapshot = await getDocs(collection(db, `tenants/${tenantId}/services`));

        if (servicesSnapshot.empty) {
            servicesContainer.innerHTML = `<p class="info-text">Este negocio aún no ha registrado servicios.</p>`;
            return;
        }

        servicesSnapshot.forEach((docSnap) => {
            const s = docSnap.data();
            const card = document.createElement('div');
            card.className = 'service-item';
            card.dataset.id = docSnap.id;
            card.innerHTML = `
                <div class="service-info">
                    <strong>${s.name}</strong>
                    <span>${s.duration} min</span>
                </div>
                <div class="service-price">$${Number(s.price).toLocaleString('es-CL')}</div>
            `;

            card.addEventListener('click', () => {
                document.querySelectorAll('.service-item').forEach(el => el.classList.remove('selected'));
                card.classList.add('selected');
                selectedService = { id: docSnap.id, ...s };
                checkFormValidity();
            });

            servicesContainer.appendChild(card);
        });

    } catch (error) {
        console.error("Error cargando servicios:", error);
    }
}

async function loadAvailableSlots(selectedDate) {
    const slotsContainer = document.getElementById('slots-container');
    slotsContainer.innerHTML = '<p class="loading-text">Buscando disponibilidad...</p>';
    selectedSlot = null;
    checkFormValidity();

    if (!currentTenant) return;

    const baseSlots = ["10:00", "11:00", "12:00", "15:00", "16:00", "17:00", "18:00"];

    try {
        const bookingsQ = query(
            collection(db, `tenants/${currentTenant.id}/bookings`),
            where("date", "==", selectedDate),
            where("status", "==", "confirmed")
        );
        const bookedSnapshot = await getDocs(bookingsQ);
        const occupiedSlots = bookedSnapshot.docs.map(doc => doc.data().time);

        const freeSlots = baseSlots.filter(slot => !occupiedSlots.includes(slot));

        slotsContainer.innerHTML = '';
        if (freeSlots.length === 0) {
            slotsContainer.innerHTML = `<p class="info-text">No hay horas disponibles para la fecha seleccionada.</p>`;
            return;
        }

        freeSlots.forEach(time => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'slot-btn';
            btn.textContent = time;

            btn.addEventListener('click', () => {
                document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedSlot = time;
                checkFormValidity();
            });

            slotsContainer.appendChild(btn);
        });

    } catch (error) {
        console.error("Error al calcular horas:", error);
        slotsContainer.innerHTML = `<p class="info-text">Error al cargar horarios.</p>`;
    }
}

function checkFormValidity() {
    const clientName = document.getElementById('client-name').value.trim();
    const clientPhone = document.getElementById('client-phone').value.trim();
    const submitBtn = document.getElementById('btn-submit');

    if (selectedService && selectedSlot && clientName !== '' && clientPhone !== '') {
        submitBtn.disabled = false;
    } else {
        submitBtn.disabled = true;
    }
}

['client-name', 'client-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', checkFormValidity);
});

async function handleBookingSubmit(e) {
    e.preventDefault();

    const clientName = document.getElementById('client-name').value.trim();
    const clientPhone = document.getElementById('client-phone').value.trim();
    const date = document.getElementById('booking-date').value;
    const submitBtn = document.getElementById('btn-submit');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando reserva...';

    try {
        const bookingData = {
            serviceId: selectedService.id,
            serviceName: selectedService.name,
            servicePrice: selectedService.price,
            date: date,
            time: selectedSlot,
            clientName: clientName,
            clientPhone: clientPhone,
            status: 'confirmed',
            createdAt: serverTimestamp()
        };

        await addDoc(collection(db, `tenants/${currentTenant.id}/bookings`), bookingData);

        document.getElementById('booking-form').classList.add('hidden');
        const successScreen = document.getElementById('success-screen');
        successScreen.classList.remove('hidden');

        document.getElementById('success-message').innerHTML = `
            Hola <strong>${clientName}</strong>, tu cita para <strong>${selectedService.name}</strong> 
            ha quedado agendada para el <strong>${date}</strong> a las <strong>${selectedSlot} hrs</strong>.
        `;

        const tenantPhone = currentTenant.phone || '56912345678';
        const msg = encodeURIComponent(
            `¡Hola! Acabo de agendar una cita mediante CitaFácil.\n\n` +
            `👤 Cliente: ${clientName}\n` +
            `✂️ Servicio: ${selectedService.name}\n` +
            `📅 Fecha: ${date}\n` +
            `⏰ Hora: ${selectedSlot} hrs`
        );
        document.getElementById('whatsapp-link').href = `https://wa.me/${tenantPhone}?text=${msg}`;

    } catch (error) {
        console.error("Error al guardar reserva:", error);
        alert("Ocurrió un problema al guardar tu cita. Inténtalo nuevamente.");
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirmar Reserva';
    }
}
