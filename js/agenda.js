import { db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    timestamp, 
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

    // 2. Cargar datos del negocio desde Firestore
    await loadTenantData(slug);
    
    // 3. Establecer fecha mínima en el DatePicker (Hoy)
    const dateInput = document.getElementById('booking-date');
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;

    // Listener para cambio de fecha
    dateInput.addEventListener('change', (e) => {
        loadAvailableSlots(e.target.value);
    });

    // Listener del formulario
    document.getElementById('booking-form').addEventListener('submit', handleBookingSubmit);
});

// Obtener datos del negocio y sus servicios
async function loadTenantData(slug) {
    try {
        const q = query(collection(db, "tenants"), where("slug", "==", slug));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            document.getElementById('business-name').textContent = "Negocio no encontrado";
            document.getElementById('services-container').innerHTML = `<p class="info-text">El enlace provisto no corresponde a una agenda activa.</p>`;
            return;
        }

        const tenantDoc = querySnapshot.docs[0];
        currentTenant = { id: tenantDoc.id, ...tenantDoc.data() };

        // Renderizar header
        document.getElementById('business-name').textContent = currentTenant.name || 'Agenda de Citas';
        document.getElementById('business-address').textContent = currentTenant.address || '📍 Santiago, Chile';
        if (currentTenant.icon) {
            document.getElementById('business-icon').textContent = currentTenant.icon;
        }

        // Cargar servicios de la subcolección
        await loadServices(tenantDoc.id);

    } catch (error) {
        console.error("Error al cargar negocio:", error);
    }
}

// Cargar subcolección /tenants/{tenantId}/services
async function loadServices(tenantId) {
    const servicesContainer = document.getElementById('services-container');
    servicesContainer.innerHTML = '';

    try {
        const servicesSnapshot = await getDocs(collection(db, `tenants/${tenantId}/services`));

        if (servicesSnapshot.empty) {
            servicesContainer.innerHTML = `<p class="info-text">Este negocio aún no ha configurado sus servicios.</p>`;
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

// Generar o filtrar bloques horarios disponibles para la fecha elegida
async function loadAvailableSlots(selectedDate) {
    const slotsContainer = document.getElementById('slots-container');
    slotsContainer.innerHTML = '<p class="loading-text">Buscando disponibilidad...</p>';
    selectedSlot = null;
    checkFormValidity();

    // Horarios estandar de atención (se pueden parametrizar por tenant)
    const baseSlots = ["10:00", "11:00", "12:00", "15:00", "16:00", "17:00", "18:00"];

    try {
        // Consultar reservas existentes para esa fecha y descartar horas ocupadas
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

// Habilitar o deshabilitar botón de confirmación
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

// Escuchar tipeo en los campos para refrescar el estado del botón
['client-name', 'client-phone'].forEach(id => {
    document.getElementById(id).addEventListener('input', checkFormValidity);
});

// Guardar reserva en Firestore
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

        // Ocultar formulario y mostrar confirmación
        document.getElementById('booking-form').classList.add('hidden');
        const successScreen = document.getElementById('success-screen');
        successScreen.classList.remove('hidden');

        document.getElementById('success-message').innerHTML = `
            Hola <strong>${clientName}</strong>, tu cita para <strong>${selectedService.name}</strong> 
            ha quedado agendada para el <strong>${date}</strong> a las <strong>${selectedSlot} hrs</strong>.
        `;

        // Crear enlace de WhatsApp para notificar al negocio
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
