import { auth, db, storage } from './firebase-config.js';
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
import { 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

let currentTenant = null;
let isRegisterMode = false;

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

    if (descEl) descEl.value = currentTenant.description || '';
    if (addressEl) addressEl.value = currentTenant.address || '';
    if (phoneEl) phoneEl.value = currentTenant.phone || '';
    if (logoEl) logoEl.value = currentTenant.logoUrl || currentTenant.icon || '';
    if (coverEl) coverEl.value = currentTenant.coverUrl || '';
    if (instaEl) instaEl.value = currentTenant.instagram || '';
    if (photosEl) photosEl.value = currentTenant.photos ? currentTenant.photos.join(', ') : '';
}

// Función helper para comprimir imágenes antes de subir
function compressImage(file, maxWidth = 1080, quality = 0.8) {
    return new Promise((resolve) => {
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

                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', quality);
            };
        };
    });
}

// Subir un archivo comprimido a Firebase Storage
async function uploadImageFile(file, pathFolder) {
    const compressedBlob = await compressImage(file);
    const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
    const storageRef = ref(storage, `tenants/${currentTenant.id}/${pathFolder}/${fileName}`);
    const snapshot = await uploadBytes(storageRef, compressedBlob);
    return await getDownloadURL(snapshot.ref);
}

// Guardar cambios del perfil (Soporta archivos y URLs)
async function handleUpdateProfile(e) {
    e.preventDefault();
    if (!currentTenant) return;

    const saveBtn = document.getElementById('btn-save-profile');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Subiendo archivos y guardando...';

    try {
        let logoUrl = document.getElementById('edit-logo').value.trim();
        let coverUrl = document.getElementById('edit-cover').value.trim();

        const logoFileInput = document.getElementById('upload-logo-file');
        if (logoFileInput && logoFileInput.files.length > 0) {
            logoUrl = await uploadImageFile(logoFileInput.files[0], "logo");
        }

        const coverFileInput = document.getElementById('upload-cover-file');
        if (coverFileInput && coverFileInput.files.length > 0) {
            coverUrl = await uploadImageFile(coverFileInput.files[0], "cover");
        }

        const photosRaw = document.getElementById('edit-photos').value.trim();
        let photoUrls = photosRaw ? photosRaw.split(',').map(p => p.trim()).filter(p => p !== '') : [];

        const galleryFilesInput = document.getElementById('upload-gallery-files');
        if (galleryFilesInput && galleryFilesInput.files.length > 0) {
            for (let i = 0; i < galleryFilesInput.files.length; i++) {
                const uploadedUrl = await uploadImageFile(galleryFilesInput.files[i], "gallery");
                photoUrls.push(uploadedUrl);
            }
        }

        const description = document.getElementById('edit-description').value.trim();
        const address = document.getElementById('edit-address').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        const instagram = document.getElementById('edit-instagram').value.trim();

        await updateDoc(doc(db, "tenants", currentTenant.id), {
            description,
            address,
            phone,
            logoUrl,
            icon: logoUrl,
            coverUrl,
            instagram,
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
            photos: photoUrls
        };

        populateProfileForm();
        alert("¡Los datos de tu landing page se han actualizado exitosamente!");
    } catch (error) {
        console.error("Error al actualizar perfil:", error);
        alert("Ocurrió un error al guardar los cambios: " + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Cambios del Perfil';
    }
}

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
