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
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

let currentTenant = null;
let isRegisterMode = false;
let allBookingsCache = [];

document.addEventListener('DOMContentLoaded', () => {
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

    document.getElementById('btn-toggle-auth').addEventListener('click', toggleAuthMode);
    document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
    document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    document.getElementById('add-service-form').addEventListener('submit', handleAddService);
    
    const profileForm = document.getElementById('profile-config-form');
    if (profileForm) {
        profileForm.addEventListener('submit', handleUpdateProfile);
    }

    const filterDate = document.getElementById('filter-date');
    const filterStatus = document.getElementById('filter-status');
    if (filterDate) filterDate.value = new Date().toISOString().split('T')[0];

    if (filterDate) filterDate.addEventListener('change', renderFilteredBookings);
    if (filterStatus) filterStatus.addEventListener('change', renderFilteredBookings);

    document.getElementById('btn-copy-url').addEventListener('click', () => {
        const input = document.getElementById('public-url-input');
        input.select();
        navigator.clipboard.writeText(input.value);
        alert("¡Enlace copiado al portapapeles!");
    });
});

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

            await setDoc(doc(db, "tenants", uid), {
                ownerUid: uid,
                name: businessName,
                slug: slug,
                email: email,
                plan: "trial",
                startHour: "09:00",
                endHour: "19:00",
                isPaused: false,
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

async function loadTenantProfile(uid) {
    try {
        const tenantDoc = await getDoc(doc(db, "tenants", uid));
        if (tenantDoc.exists()) {
            currentTenant = { id: tenantDoc.id, ...tenantDoc.data() };
            
            const publicUrl = `${window.location.origin}/${currentTenant.slug}`;
            document.getElementById('public-url-input').value = publicUrl;
            document.getElementById('btn-visit-public').href = `../agenda.html?b=${currentTenant.slug}`;

            populateProfileForm();
            await loadBookings();
            await loadServicesAdmin();
        }
    } catch (error) {
        console.error("Error al cargar perfil:", error);
    }
}

function populateProfileForm() {
    if (!currentTenant) return;

    const descEl = document.getElementById('edit-description');
    const addressEl = document.getElementById('edit-address');
    const phoneEl = document.getElementById('edit-phone');
    const logoEl = document.getElementById('edit-logo');
    const coverEl = document.getElementById('edit-cover');
    const instaEl = document.getElementById('edit-instagram');
    const photosEl = document.getElementById('edit-photos');
    const startHourEl = document.getElementById('edit-start-hour');
    const endHourEl = document.getElementById('edit-end-hour');
    const isPausedEl = document.getElementById('edit-is-paused');

    if (descEl) descEl.value = currentTenant.description || '';
    if (addressEl) addressEl.value = currentTenant.address || '';
    if (phoneEl) phoneEl.value = currentTenant.phone || '';
    if (startHourEl) startHourEl.value = currentTenant.startHour || '09:00';
    if (endHourEl) endHourEl.value = currentTenant.endHour || '19:00';
    if (isPausedEl) isPausedEl.checked = currentTenant.isPaused || false;

    if (logoEl) {
        const val = currentTenant.logoUrl || currentTenant.icon || '';
        logoEl.value = val.startsWith('data:image') ? '📷 [Imagen de archivo subida]' : val;
    }
    if (coverEl) {
        const val = currentTenant.coverUrl || '';
        coverEl.value = val.startsWith('data:image') ? '🖼️ [Imagen de archivo subida]' : val;
    }
    if (instaEl) instaEl.value = currentTenant.instagram || '';

    if (photosEl) {
        const httpPhotos = (currentTenant.photos || []).filter(p => p.startsWith('http'));
        photosEl.value = httpPhotos.join(', ');
    }
}

function fileToWebPBase64(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const base64DataUrl = canvas.toDataURL('image/webp', quality);
                resolve(base64DataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

function parsePhotoUrls(photosInput) {
    if (!photosInput) return [];
    return photosInput
        .split(/(?=https?:\/\/|data:image\/)/g)
        .map(url => url.trim().replace(/^,|,$/g, ''))
        .filter(url => url !== '');
}

async function handleUpdateProfile(e) {
    e.preventDefault();
    if (!currentTenant) return;

    const saveBtn = document.getElementById('btn-save-profile');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Procesando imágenes y guardando...';

    try {
        let logoUrl = document.getElementById('edit-logo').value.trim();
        let coverUrl = document.getElementById('edit-cover').value.trim();

        if (logoUrl.startsWith('📷')) logoUrl = currentTenant.logoUrl || '';
        if (coverUrl.startsWith('🖼️')) coverUrl = currentTenant.coverUrl || '';

        const logoFileInput = document.getElementById('upload-logo-file');
        if (logoFileInput && logoFileInput.files.length > 0) {
            logoUrl = await fileToWebPBase64(logoFileInput.files[0], 400, 0.8);
        }

        const coverFileInput = document.getElementById('upload-cover-file');
        if (coverFileInput && coverFileInput.files.length > 0) {
            coverUrl = await fileToWebPBase64(coverFileInput.files[0], 1000, 0.75);
        }

        const existingBase64Photos = (currentTenant.photos || []).filter(p => p.startsWith('data:image'));
        const photosRaw = document.getElementById('edit-photos').value.trim();
        let photoUrls = [...existingBase64Photos, ...parsePhotoUrls(photosRaw)];

        const galleryFilesInput = document.getElementById('upload-gallery-files');
        if (galleryFilesInput && galleryFilesInput.files.length > 0) {
            for (let i = 0; i < galleryFilesInput.files.length; i++) {
                const base64Photo = await fileToWebPBase64(galleryFilesInput.files[i], 800, 0.7);
                photoUrls.push(base64Photo);
            }
        }

        const description = document.getElementById('edit-description').value.trim();
        const address = document.getElementById('edit-address').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        const instagram = document.getElementById('edit-instagram').value.trim();
        const startHour = document.getElementById('edit-start-hour').value;
        const endHour = document.getElementById('edit-end-hour').value;
        const isPaused = document.getElementById('edit-is-paused').checked;

        await updateDoc(doc(db, "tenants", currentTenant.id), {
            description,
            address,
            phone,
            logoUrl,
            icon: logoUrl,
            coverUrl,
            instagram,
            startHour,
            endHour,
            isPaused,
            photos: photoUrls
        });

        currentTenant = {
            ...currentTenant,
            description,
            address,
            phone,
            logoUrl,
            icon: logoUrl,
            coverUrl,
            instagram,
            startHour,
            endHour,
            isPaused,
            photos: photoUrls
        };

        populateProfileForm();
        alert("¡Tu perfil y configuración se guardaron exitosamente!");

    } catch (error) {
        console.error("Error al actualizar perfil:", error);
        alert("Ocurrió un error al guardar los cambios: " + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Cambios del Perfil';
    }
}

async function loadBookings() {
    try {
        const snapshot = await getDocs(collection(db, `tenants/${currentTenant.id}/bookings`));
        allBookingsCache = [];
        snapshot.forEach(docSnap => {
            allBookingsCache.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderFilteredBookings();
    } catch (error) {
        console.error("Error cargando citas:", error);
    }
}

function renderFilteredBookings() {
    const listContainer = document.getElementById('bookings-list');
    const selectedDate = document.getElementById('filter-date').value;
    const selectedStatus = document.getElementById('filter-status').value;

    listContainer.innerHTML = '';

    let filtered = allBookingsCache.filter(b => {
        const matchesDate = !selectedDate || b.date === selectedDate;
        const status = b.status || 'confirmed';
        const matchesStatus = selectedStatus === 'all' || status === selectedStatus;
        return matchesDate && matchesStatus;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = '<p class="loading-text">No hay citas para los filtros seleccionados.</p>';
        return;
    }

    filtered.sort((a, b) => a.time.localeCompare(b.time));

    filtered.forEach(b => {
        const status = b.status || 'confirmed';
        let statusBadge = '<span style="color:#d97706; font-weight:700;">Pendiente</span>';
        if (status === 'terminada') statusBadge = '<span style="color:#059669; font-weight:700;">Atendida / Terminada</span>';
        if (status === 'cancelada') statusBadge = '<span style="color:#dc2626; font-weight:700;">Cancelada</span>';
        if (status === 'no-vino') statusBadge = '<span style="color:#4b5563; font-weight:700;">No vino</span>';

        const card = document.createElement('div');
        card.className = 'booking-card-item';
        card.innerHTML = `
            <h4>${b.clientName}</h4>
            <div class="booking-meta">
                <strong>Servicio:</strong> ${b.serviceName} ($${Number(b.servicePrice).toLocaleString('es-CL')})<br>
                <strong>Fecha:</strong> ${b.date} - ${b.time} hrs<br>
                <strong>Estado:</strong> ${statusBadge}
            </div>
            
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center;">
                <a href="https://wa.me/${b.clientPhone.replace(/\+/g, '')}" target="_blank" class="booking-phone">
                    💬 WhatsApp
                </a>
                
                <select class="status-selector" data-id="${b.id}" style="padding: 7px 10px; border-radius: 8px; border: 1.5px solid var(--border); font-size: 13px; font-weight: 600; font-family: inherit;">
                    <option value="confirmed" ${status === 'confirmed' ? 'selected' : ''}>Pendiente</option>
                    <option value="terminada" ${status === 'terminada' ? 'selected' : ''}>Atendida</option>
                    <option value="cancelada" ${status === 'cancelada' ? 'selected' : ''}>Cancelada</option>
                    <option value="no-vino" ${status === 'no-vino' ? 'selected' : ''}>No vino</option>
                </select>
            </div>
        `;

        card.querySelector('.status-selector').addEventListener('change', async (e) => {
            const newStatus = e.target.value;
            await updateBookingStatus(b.id, newStatus);
        });

        listContainer.appendChild(card);
    });
}

async function updateBookingStatus(bookingId, newStatus) {
    try {
        await updateDoc(doc(db, `tenants/${currentTenant.id}/bookings`, bookingId), {
            status: newStatus
        });
        const index = allBookingsCache.findIndex(b => b.id === bookingId);
        if (index !== -1) {
            allBookingsCache[index].status = newStatus;
        }
        renderFilteredBookings();
    } catch (error) {
        console.error("Error al actualizar estado:", error);
        alert("No se pudo actualizar el estado de la cita.");
    }
}

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
                <div>
                    <h4>${s.name}</h4>
                    <div class="booking-meta">
                        Duración: ${s.duration} min | Precio: $${Number(s.price).toLocaleString('es-CL')}
                    </div>
                </div>
                <button class="btn-logout" data-id="${docSnap.id}">Eliminar</button>
            `;

            card.querySelector('button').addEventListener('click', async () => {
                if (confirm("¿Estás seguro de eliminar este servicio?")) {
                    await deleteDoc(doc(db, `tenants/${currentTenant.id}/services`, docSnap.id));
                    loadServicesAdmin();
                }
            });

            container.appendChild(card);
        });
    } catch (error) {
        console.error("Error cargando servicios admin:", error);
    }
}

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
