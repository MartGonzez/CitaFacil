import { auth, db } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    setDoc, 
    addDoc, 
    deleteDoc, 
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

let currentTenant = null;
let isRegisterMode = false;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Escuchar cambios de autenticación
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            document.getElementById('auth-container').classList.add('hidden');
            document.getElementById('dashboard-container').classList.remove('hidden');
            document.getElementById('user-email-display').textContent = user.email;
            await loadTenantProfile(user.uid);
        } else {
            document.getElementById('auth-container').classList.remove('hidden');
            document.getElementById('dashboard-container').classList.add('hidden');
        }
    });

    // Toggle entre Iniciar Sesión y Registro
    document.getElementById('btn-toggle-auth').addEventListener('click', toggleAuthMode);
    
    // Formulario de Auth
    document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

    // Navegación por pestañas
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Formulario agregar servicio
    document.getElementById('add-service-form').addEventListener('submit', handleAddService);
    
    // Copiar URL pública
    document.getElementById('btn-copy-url').addEventListener('click', () => {
        const input = document.getElementById('public-url-input');
        input.select();
        navigator.clipboard.writeText(input.value);
        alert("¡Enlace copiado al portapapeles!");
    });
});

// Alternar entre Login y Registro
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    const subtitle = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('btn-auth-submit');
    const toggleBtn = document.getElementById('btn-toggle-auth');
    const nameField = document.getElementById('field-business-name');
    const slugField = document.getElementById('field-slug');

    if (isRegisterMode) {
        subtitle.textContent = "Registra tu negocio en 1 minuto";
        submitBtn.textContent = "Crear Cuenta Gratis";
        toggleBtn.textContent = "Ya tengo cuenta (Iniciar Sesión)";
        nameField.style.display = 'block';
        slugField.style.display = 'block';
    } else {
        subtitle.textContent = "Ingresa a tu panel de control";
        submitBtn.textContent = "Iniciar Sesión";
        toggleBtn.textContent = "Registrar mi negocio";
        nameField.style.display = 'none';
        slugField.style.display = 'none';
    }
}

// Enviar login / registro
async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    try {
        if (isRegisterMode) {
            const businessName = document.getElementById('reg-business-name').value.trim();
            const slug = document.getElementById('reg-slug').value.trim().toLowerCase().replace(/\s+/g, '-');

            if (!businessName || !slug) {
                alert("Por favor completa el nombre del negocio y el enlace.");
                return;
            }

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const uid = userCredential.user.uid;

            // Crear documento de tenant
            await setDoc(doc(db, "tenants", uid), {
                ownerUid: uid,
                name: businessName,
                slug: slug,
                email: email,
                plan: "trial",
                createdAt: new Date()
            });

        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
    } catch (error) {
        console.error("Error de Auth:", error);
        alert("Error de autenticación: " + error.message);
    }
}

// Cargar perfil del negocio autenticado
async function loadTenantProfile(uid) {
    try {
        const tenantDoc = await getDoc(doc(db, "tenants", uid));
        if (tenantDoc.exists()) {
            currentTenant = { id: tenantDoc.id, ...tenantDoc.data() };
            
            // Configurar URL pública
            const publicUrl = `${window.location.origin}/${currentTenant.slug}`;
            document.getElementById('public-url-input').value = publicUrl;
            document.getElementById('btn-visit-public').href = `../agenda.html?b=${currentTenant.slug}`;

            // Cargar datos del dashboard
            await loadBookings();
            await loadServicesAdmin();
        }
    } catch (error) {
        console.error("Error al cargar perfil:", error);
    }
}

// Cargar citas agendadas
async function loadBookings() {
    const listContainer = document.getElementById('bookings-list');
    listContainer.innerHTML = '';

    try {
        const snapshot = await getDocs(collection(db, `tenants/${currentTenant.id}/bookings`));
        if (snapshot.empty) {
            listContainer.innerHTML = '<p class="loading-text">Aún no registras citas agendadas.</p>';
            return;
        }

        snapshot.forEach(docSnap => {
            const b = docSnap.data();
            const card = document.createElement('div');
            card.className = 'booking-card-item';
            card.innerHTML = `
                <h4>${b.clientName}</h4>
                <div class="booking-meta">
                    <strong>Servicio:</strong> ${b.serviceName}<br>
                    <strong>Fecha:</strong> ${b.date} - ${b.time} hrs
                </div>
                <a href="https://wa.me/${b.clientPhone.replace(/\+/g, '')}" target="_blank" class="booking-phone">
                    💬 Contactar por WhatsApp
                </a>
            `;
            listContainer.appendChild(card);
        });
    } catch (error) {
        console.error("Error cargando citas:", error);
    }
}

// Cargar servicios en el panel
async function loadServicesAdmin() {
    const container = document.getElementById('services-list-admin');
    container.innerHTML = '';

    try {
        const snapshot = await getDocs(collection(db, `tenants/${currentTenant.id}/services`));
        if (snapshot.empty) {
            container.innerHTML = '<p class="loading-text">No has agregado servicios todavía.</p>';
            return;
        }

        snapshot.forEach(docSnap => {
            const s = docSnap.data();
            const card = document.createElement('div');
            card.className = 'service-card-admin';
            card.innerHTML = `
                <h4>${s.name}</h4>
                <div class="booking-meta">
                    Duración: ${s.duration} min | Precio: $${Number(s.price).toLocaleString('es-CL')}
                </div>
                <button class="btn-logout" style="width: auto;" data-id="${docSnap.id}">Eliminar</button>
            `;

            card.querySelector('button').addEventListener('click', async () => {
                await deleteDoc(doc(db, `tenants/${currentTenant.id}/services`, docSnap.id));
                loadServicesAdmin();
            });

            container.appendChild(card);
        });
    } catch (error) {
        console.error("Error cargando servicios admin:", error);
    }
}

// Agregar servicio
async function handleAddService(e) {
    e.preventDefault();
    const name = document.getElementById('service-name').value.trim();
    const price = Number(document.getElementById('service-price').value);
    const duration = Number(document.getElementById('service-duration').value);

    try {
        await addDoc(collection(db, `tenants/${currentTenant.id}/services`), {
            name, price, duration, createdAt: new Date()
        });
        document.getElementById('add-service-form').reset();
        await loadServicesAdmin();
    } catch (error) {
        console.error("Error al guardar servicio:", error);
    }
}
