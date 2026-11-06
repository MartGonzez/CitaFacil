import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Estado de la reserva activa
let currentTenant = null;
let selectedService = null;
let selectedSlot = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Obtener el slug desde la URL (query parameter o pathname)
    const urlParams = new URLSearchParams(window.location.search);
    let slug = urlParams.get('b');

    // Si viene por rewrite de Vercel (/barberia-el-sol)
    if (!slug) {
        const pathSegments = window.location.pathname.split('/').filter(p => p);
        if (pathSegments.length > 0 && pathSegments[0] !== 'agenda.html') {
            slug = pathSegments[0];
        }
    }

    // Slug por defecto para pruebas locales si no hay parámetro
    if (!slug) slug = 'barberia-demo';

    console.log("Cargando slug:", slug);

    // 2. Cargar datos del negocio desde Firestore
    await loadTenantData(slug);
    
    // 3. Establecer fecha mínima en el DatePicker (Hoy)
    const dateInput = document.getElementById('booking-date');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.min = today;

        dateInput.addEventListener('change', (e) => {
            loadAvailableSlots(e.target.value);
        });
    }

    // Listener del formulario
    const form = document.getElementById('booking-form');
    if (form) {
        form.addEventListener('submit', handleBookingSubmit);
    }
});

// Obtener datos del negocio y sus servicios
async function loadTenantData(slug) {
    const nameEl = document.getElementById('business-name');
    const addressEl = document.getElementById('business-address');
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

        // Renderizar header
        nameEl.textContent = currentTenant.name || 'Agenda de Citas';
        addressEl.textContent = currentTenant.address || '📍 Santiago, Chile';
        if (currentTenant.icon) {
            document.getElementById('business-icon').textContent = currentTenant.icon;
        }

        // Cargar servicios de la subcolección
        await loadServices(tenantDoc.id);

    } catch (error) {
        console.error("Error crítico al cargar negocio:", error);
        nameEl.textContent = "Error de conexión con Firebase";
        addressEl.textContent = "📍 Revisa las credenciales en js/firebase-config.js";
        servicesContainer.innerHTML = `
            <div style="color: #ef4444; font-size: 13px; text-align: center; padding: 10px; background: #fee2e2; border-radius: 8px;">
                <strong>Detalle del error:</strong><br>${error.message}
            </div>
        `;
    }
}

// Cargar subcolección /tenants/{tenantId}/services
async function loadServices(tenantId) {
    const servicesContainer = document.getElementById('services-container');
    servicesContainer.innerHTML = '';

    try {
        const servicesSnapshot = await getDocs(collection(db, `tenants/${tenantId}/services`));

        if (servicesSnapshot.empty) {
            servicesContainer.innerHTML = `<p class="info-text">Este negocio aún no ha registrado servicios en el panel admin.</p>`;
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
        servicesContainer.innerHTML = `<p class="info-text" style="color:red;">Error al cargar la lista de servicios.</p>`;
    }
}

// Generar o filtrar bloques horarios disponibles
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

// Validar estado del formulario
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

// Guardar reserva
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
