import { auth, db, firebaseConfig } from './firebase-config.js';
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { 
    getAuth,
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
    updateDoc,
    query,
    where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// CORREO DE ADMINISTRADOR (Solo este correo verá el panel para crear clientes)
const SUPER_ADMIN_EMAIL = "martgonzez@gmail.com";

let currentTenant = null;
let allBookingsCache = [];

document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            document.getElementById('auth-container').classList.add('hidden');
            document.getElementById('dashboard-container').classList.remove('hidden');
            document.getElementById('user-email-display').textContent = user.email;

            const masterNav = document.getElementById('nav-master-admin');
            if (masterNav) {
                masterNav.style.display = (user.email === SUPER_ADMIN_EMAIL) ? 'flex' : 'none';
            }

            await loadTenantProfile(user.uid);
        } else {
            document.getElementById('auth-container').classList.remove('hidden');
            document.getElementById('dashboard-container').classList.add('hidden');
        }
    });

    // Solo Login
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value.trim();
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error("Error de Auth:", error);
            alert("Correo o contraseña incorrectos.");
        }
    });

    document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

    // Formulario de Creación de Cliente (SuperAdmin)
    const createClientForm = document.getElementById('create-client-form');
    if (createClientForm) {
        createClientForm.addEventListener('submit', handleCreateClientAccount);
    }

    const btnCopySummary = document.getElementById('btn-copy-summary');
    if (btnCopySummary) {
        btnCopySummary.addEventListener('click', () => {
            const txt = document.getElementById('new-client-summary');
            txt.select();
            navigator.clipboard.writeText(txt.value);
            alert("¡Datos copiados al portapapeles!");
        });
    }

    // Navegación de pestañas
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

    // Filtros de Citas
    const filterOrder = document.getElementById('filter-order');
    const filterDate = document.getElementById('filter-date');
    const filterStatus = document.getElementById('filter-status');
    const btnClearDate = document.getElementById('btn-clear-date');

    if (filterOrder) filterOrder.addEventListener('change', renderFilteredBookings);
    if (filterDate) filterDate.addEventListener('change', renderFilteredBookings);
    if (filterStatus) filterStatus.addEventListener('change', renderFilteredBookings);

    if (btnClearDate && filterDate) {
        btnClearDate.addEventListener('click', () => {
            filterDate.value = '';
            renderFilteredBookings();
        });
    }

    document.getElementById('btn-copy-url').addEventListener('click', () => {
        const input = document.getElementById('public-url-input');
        input.select();
        navigator.clipboard.writeText(input.value);
        alert("¡Enlace copiado al portapapeles!");
    });
});

// Función para crear cliente sin cerrar tu sesión
async function handleCreateClientAccount(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-create-client');
    btn.disabled = true;
    btn.textContent = "Creando cuenta y subdominio...";

    const businessName = document.getElementById('new-client-business').value.trim();
    const rawSlug = document.getElementById('new-client-slug').value.trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const email = document.getElementById('new-client-email').value.trim();
    const password = document.getElementById('new-client-password').value.trim();
    const phone = document.getElementById('new-client-phone').value.trim();
    const address = document.getElementById('new-client-address').value.trim();

    let secondaryApp = null;

    try {
        // 1. Verificar que el slug no esté ocupado
        const slugQuery = query(collection(db, "tenants"), where("slug", "==", rawSlug));
        const slugSnap = await getDocs(slugQuery);
        if (!slugSnap.empty) {
            alert(`El enlace "citafacil.cl/${rawSlug}" ya está ocupado por otro negocio. Elige otro.`);
            btn.disabled = false;
            btn.textContent = "Crear Cuenta Vitalicia y Generar Link";
            return;
        }

        // 2. Crear usuario en instancia secundaria para mantener tu sesión activa
        secondaryApp = initializeApp(firebaseConfig, "SecondaryCreatorApp_" + Date.now());
        const secondaryAuth = getAuth(secondaryApp);
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUid = userCredential.user.uid;

        // 3. Guardar perfil vitalicio en Firestore
        await setDoc(doc(db, "tenants", newUid), {
            ownerUid: newUid,
            name: businessName,
            slug: rawSlug,
            email: email,
            phone: phone,
            address: address,
            plan: "lifetime",
            isLifetime: true,
            startHour: "09:00",
            endHour: "19:00",
            workingDays: [1, 2, 3, 4, 5, 6],
            maxAdvanceDays: 30,
            hasBreak: false,
            breakStart: "13:00",
            breakEnd: "14:00",
            isPaused: false,
            photos: [],
            createdAt: new Date()
        });

        await signOut(secondaryAuth);
        await deleteApp(secondaryApp);

        // 4. Mostrar resumen listo para enviar por WhatsApp
        const publicLink = `${window.location.origin}/${rawSlug}`;
        const adminLink = `${window.location.origin}/index-admin.html`;
        const summaryText = 
            `¡Hola! Tu agenda online en *CitaFácil* ya está activa de por vida 🎉\n\n` +
            `🔗 *Tu enlace público para clientes:*\n${publicLink}\n\n` +
            `⚙️ *Tu panel de administración:*\n${adminLink}\n` +
            `📧 *Usuario:* ${email}\n` +
            `🔑 *Contraseña:* ${password}`;

        document.getElementById('new-client-summary').value = summaryText;
        document.getElementById('new-client-result').classList.remove('hidden');

        if (phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            document.getElementById('btn-send-client-wa').href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(summaryText)}`;
        }

        document.getElementById('create-client-form').reset();

    } catch (error) {
        console.error("Error creando cliente:", error);
        alert("Error al crear cuenta: " + error.message);
        if (secondaryApp) await deleteApp(secondaryApp);
    } finally {
        btn.disabled = false;
        btn.textContent = "Crear Cuenta Vitalicia y Generar Link";
    }
}

async function loadTenantProfile(uid) {
    try {
        const tenantDoc = await getDoc(doc(db, "tenants", uid));
        if (tenantDoc.exists()) {
            currentTenant = { id: tenantDoc.id, ...tenantDoc.data() };
            
            const publicUrl = `${window.location.origin}/${currentTenant.slug}`;
            document.getElementById('public-url-input').value = publicUrl;
            document.getElementById('btn-visit-public').href = `agenda.html?b=${currentTenant.slug}`;

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
    const maxAdvanceEl = document.getElementById('edit-max-advance');
    const hasBreakEl = document.getElementById('edit-has-break');
    const breakStartEl = document.getElementById('edit-break-start');
    const breakEndEl = document.getElementById('edit-break-end');

    if (descEl) descEl.value = currentTenant.description || '';
    if (addressEl) addressEl.value = currentTenant.address || '';
    if (phoneEl) phoneEl.value = currentTenant.phone || '';
    if (startHourEl) startHourEl.value = currentTenant.startHour || '09:00';
    if (endHourEl) endHourEl.value = currentTenant.endHour || '19:00';
    if (maxAdvanceEl) maxAdvanceEl.value = currentTenant.maxAdvanceDays || 30;
    if (isPausedEl) isPausedEl.checked = currentTenant.isPaused || false;
    if (hasBreakEl) hasBreakEl.checked = currentTenant.hasBreak || false;
    if (breakStartEl) breakStartEl.value = currentTenant.breakStart || '13:00';
    if (breakEndEl) breakEndEl.value = currentTenant.breakEnd || '14:00';

    const activeWorkingDays = currentTenant.workingDays || [1, 2, 3, 4, 5, 6];
    document.querySelectorAll('.work-day-check').forEach(chk => {
        chk.checked = activeWorkingDays.includes(Number(chk.value));
    });

    if (logoEl) {
        const val = currentTenant.logoUrl || currentTenant.icon || '';
        logoEl.value = val.startsWith('http') ? val : '';
    }
    if (coverEl) {
        const val = currentTenant.coverUrl || '';
        coverEl.value = val.startsWith('http') ? val : '';
    }
    if (instaEl) instaEl.value = currentTenant.instagram || '';

    if (photosEl) {
        photosEl.value = '';
    }

    renderImagePreviews();
}

function isInstagramPostUrl(url) {
    return /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/i.test(url.trim());
}

function renderImagePreviews() {
    if (!currentTenant) return;

    const logoBox = document.getElementById('logo-preview-box');
    const logoSrc = currentTenant.logoUrl || currentTenant.icon;
    if (logoSrc) {
        logoBox.innerHTML = `
            <div class="thumb-preview-item">
                <img src="${logoSrc}" alt="Logo">
                <button type="button" class="btn-delete-thumb" id="btn-delete-logo">🗑️ Eliminar</button>
            </div>
        `;
        document.getElementById('btn-delete-logo').addEventListener('click', async () => {
            currentTenant.logoUrl = '';
            currentTenant.icon = '';
            await updateDoc(doc(db, "tenants", currentTenant.id), { logoUrl: '', icon: '' });
            populateProfileForm();
        });
    } else {
        logoBox.innerHTML = '';
    }

    const coverBox = document.getElementById('cover-preview-box');
    if (currentTenant.coverUrl) {
        coverBox.innerHTML = `
            <div class="thumb-preview-item">
                <img src="${currentTenant.coverUrl}" alt="Portada">
                <button type="button" class="btn-delete-thumb" id="btn-delete-cover">🗑️ Eliminar</button>
            </div>
        `;
        document.getElementById('btn-delete-cover').addEventListener('click', async () => {
            currentTenant.coverUrl = '';
            await updateDoc(doc(db, "tenants", currentTenant.id), { coverUrl: '' });
            populateProfileForm();
        });
    } else {
        coverBox.innerHTML = '';
    }

    const galleryContainer = document.getElementById('gallery-preview-admin');
    const countEl = document.getElementById('gallery-count');
    galleryContainer.innerHTML = '';

    const photos = currentTenant.photos || [];
    if (countEl) countEl.textContent = photos.length;

    if (photos.length === 0) {
        galleryContainer.innerHTML = '<p class="loading-text">No has agregado fotos ni posts aún (opcional, máx. 6).</p>';
        return;
    }

    photos.forEach((photoUrl, index) => {
        const item = document.createElement('div');
        item.className = 'thumb-preview-item';

        if (isInstagramPostUrl(photoUrl)) {
            item.innerHTML = `
                <div style="width:100%; height:80px; border-radius:6px; background:linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%); color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:11px; font-weight:700; text-align:center; padding:4px;">
                    <span style="font-size:20px;">📸</span>
                    <span>Post IG #${index + 1}</span>
                </div>
                <button type="button" class="btn-delete-thumb">🗑️ Eliminar</button>
            `;
        } else {
            item.innerHTML = `
                <img src="${photoUrl}" alt="Foto ${index + 1}">
                <button type="button" class="btn-delete-thumb">🗑️ Eliminar</button>
            `;
        }

        item.querySelector('button').addEventListener('click', async () => {
            currentTenant.photos.splice(index, 1);
            await updateDoc(doc(db, "tenants", currentTenant.id), { photos: currentTenant.photos });
            populateProfileForm();
        });

        galleryContainer.appendChild(item);
    });
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
        .split(/[\s,]+/g)
        .map(url => url.trim())
        .filter(url => url !== '' && /^https?:\/\//i.test(url));
}

async function handleUpdateProfile(e) {
    e.preventDefault();
    if (!currentTenant) return;

    const existingPhotos = currentTenant.photos || [];
    const newHttpPhotos = parsePhotoUrls(document.getElementById('edit-photos').value.trim());
    const galleryFilesInput = document.getElementById('upload-gallery-files');
    const newFilesCount = galleryFilesInput ? galleryFilesInput.files.length : 0;

    // Validar máximo de 6 elementos en total (fotos + posts de Instagram)
    const totalProjected = existingPhotos.length + newHttpPhotos.length + newFilesCount;
    if (totalProjected > 6) {
        const disponibles = Math.max(0, 6 - existingPhotos.length);
        alert(`El máximo permitido es de 6 fotos o publicaciones de Instagram en total.\nActualmente tienes ${existingPhotos.length} guardadas y solo puedes agregar ${disponibles} más.`);
        return;
    }

    const saveBtn = document.getElementById('btn-save-profile');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando configuración...';

    try {
        let logoUrl = document.getElementById('edit-logo').value.trim() || currentTenant.logoUrl || '';
        let coverUrl = document.getElementById('edit-cover').value.trim() || currentTenant.coverUrl || '';

        const logoFileInput = document.getElementById('upload-logo-file');
        if (logoFileInput && logoFileInput.files.length > 0) {
            logoUrl = await fileToWebPBase64(logoFileInput.files[0], 400, 0.8);
        }

        const coverFileInput = document.getElementById('upload-cover-file');
        if (coverFileInput && coverFileInput.files.length > 0) {
            coverUrl = await fileToWebPBase64(coverFileInput.files[0], 1000, 0.75);
        }

        let photoUrls = [...existingPhotos, ...newHttpPhotos];

        if (galleryFilesInput && galleryFilesInput.files.length > 0) {
            for (let i = 0; i < galleryFilesInput.files.length; i++) {
                const base64Photo = await fileToWebPBase64(galleryFilesInput.files[i], 800, 0.7);
                photoUrls.push(base64Photo);
            }
        }

        photoUrls = [...new Set(photoUrls)].slice(0, 6);

        const workingDays = [];
        document.querySelectorAll('.work-day-check:checked').forEach(chk => {
            workingDays.push(Number(chk.value));
        });

        const description = document.getElementById('edit-description').value.trim();
        const address = document.getElementById('edit-address').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        const instagram = document.getElementById('edit-instagram').value.trim();
        const startHour = document.getElementById('edit-start-hour').value || '09:00';
        const endHour = document.getElementById('edit-end-hour').value || '19:00';
        const maxAdvanceDays = Number(document.getElementById('edit-max-advance').value) || 30;
        const isPaused = document.getElementById('edit-is-paused').checked;
        const hasBreak = document.getElementById('edit-has-break').checked;
        const breakStart = document.getElementById('edit-break-start').value || '13:00';
        const breakEnd = document.getElementById('edit-break-end') ? document.getElementById('edit-break-end').value : '14:00';

        const updatedData = {
            description,
            address,
            phone,
            logoUrl,
            icon: logoUrl,
            coverUrl,
            instagram,
            startHour,
            endHour,
            workingDays,
            maxAdvanceDays,
            hasBreak,
            breakStart,
            breakEnd,
            isPaused,
            photos: photoUrls
        };

        await setDoc(doc(db, "tenants", currentTenant.id), updatedData, { merge: true });

        currentTenant = {
            ...currentTenant,
            ...updatedData
        };

        if (logoFileInput) logoFileInput.value = '';
        if (coverFileInput) coverFileInput.value = '';
        if (galleryFilesInput) galleryFilesInput.value = '';
        document.getElementById('edit-photos').value = '';

        populateProfileForm();
        alert("¡Tu perfil y galería se guardaron correctamente!");

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

function getRelativeTimeInfo(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = (timeStr || '00:00').split(':').map(Number);

    const targetDate = new Date(year, month - 1, day, hour, minute, 0);
    const now = new Date();
    const diffMs = targetDate - now;

    // Formatear fecha legible en español (Ej: "vie, 27 nov")
    const formattedDate = targetDate.toLocaleDateString('es-CL', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });

    // Comparación por día calendario (medianoche a medianoche)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDayStart = new Date(year, month - 1, day);
    const diffDays = Math.round((targetDayStart - todayStart) / (1000 * 60 * 60 * 24));

    if (diffMs < 0) {
        if (diffDays === 0) {
            return {
                label: 'Hoy (ya pasó la hora)',
                formattedDate,
                bg: '#f1f5f9',
                color: '#64748b',
                border: '#cbd5e1',
                isPast: true
            };
        }
        const pastDays = Math.abs(diffDays);
        return {
            label: pastDays === 1 ? 'Ayer' : `Hace ${pastDays} días`,
            formattedDate,
            bg: '#f1f5f9',
            color: '#64748b',
            border: '#cbd5e1',
            isPast: true
        };
    }

    // Es HOY (faltan horas o minutos)
    if (diffDays === 0) {
        const diffMins = Math.round(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMins / 60);
        const remMins = diffMins % 60;

        let timeText = '¡Es ahora!';
        if (diffHours >= 1) {
            timeText = remMins > 0 ? `Hoy • en ${diffHours} h ${remMins} min` : `Hoy • en ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
        } else if (diffMins > 0) {
            timeText = `Hoy • en ${diffMins} min`;
        }

        return {
            label: timeText,
            formattedDate,
            bg: '#fef2f2',
            color: '#dc2626',
            border: '#fecaca',
            isPast: false
        };
    }

    // Es MAÑANA
    if (diffDays === 1) {
        return {
            label: 'Mañana',
            formattedDate,
            bg: '#fffbeb',
            color: '#d97706',
            border: '#fde68a',
            isPast: false
        };
    }

    // Menos de 1 semana (2 a 6 días)
    if (diffDays < 7) {
        return {
            label: `En ${diffDays} días`,
            formattedDate,
            bg: '#ecfdf5',
            color: '#059669',
            border: '#a7f3d0',
            isPast: false
        };
    }

    // 1 semana o más
    const weeks = Math.floor(diffDays / 7);
    const extraDays = diffDays % 7;
    let weekLabel = weeks === 1 ? 'En 1 semana' : `En ${weeks} semanas`;
    if (extraDays > 0) {
        weekLabel += ` y ${extraDays} ${extraDays === 1 ? 'día' : 'días'}`;
    }

    return {
        label: weekLabel,
        formattedDate,
        bg: '#eff6ff',
        color: '#2563eb',
        border: '#bfdbfe',
        isPast: false
    };
}

function renderFilteredBookings() {
    const listContainer = document.getElementById('bookings-list');
    const selectedOrder = document.getElementById('filter-order')?.value || 'upcoming';
    const selectedDate = document.getElementById('filter-date')?.value || '';
    const selectedStatus = document.getElementById('filter-status')?.value || 'all';

    listContainer.innerHTML = '';

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    let filtered = allBookingsCache.filter(b => {
        const matchesDate = !selectedDate || b.date === selectedDate;
        const status = b.status || 'confirmed';
        const matchesStatus = selectedStatus === 'all' || status === selectedStatus;
        const matchesUpcoming = (selectedOrder !== 'upcoming' || selectedDate !== '') ? true : (b.date >= todayStr);
        return matchesDate && matchesStatus && matchesUpcoming;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = '<p class="loading-text">No hay citas para los filtros seleccionados.</p>';
        return;
    }

    // Ordenar cronológicamente (fecha + hora)
    filtered.sort((a, b) => {
        const dtA = `${a.date}T${a.time || '00:00'}`;
        const dtB = `${b.date}T${b.time || '00:00'}`;
        return selectedOrder === 'all-desc' ? dtB.localeCompare(dtA) : dtA.localeCompare(dtB);
    });

    filtered.forEach(b => {
        const status = b.status || 'confirmed';
        let statusBadge = '<span style="color:#d97706; font-weight:700;">Pendiente</span>';
        if (status === 'terminada') statusBadge = '<span style="color:#059669; font-weight:700;">Atendida / Terminada</span>';
        if (status === 'cancelada') statusBadge = '<span style="color:#dc2626; font-weight:700;">Cancelada</span>';
        if (status === 'no-vino') statusBadge = '<span style="color:#4b5563; font-weight:700;">No vino</span>';

        const timeInfo = getRelativeTimeInfo(b.date, b.time);

        const card = document.createElement('div');
        card.className = 'booking-card-item';
        card.style.borderLeft = `4px solid ${timeInfo.color}`;

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
                <span style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 800; background: ${timeInfo.bg}; color: ${timeInfo.color}; border: 1px solid ${timeInfo.border};">
                    ⏳ ${timeInfo.label}
                </span>
                <span style="font-size: 13px; font-weight: 800; color: var(--dark); background: var(--bg-light); padding: 4px 10px; border-radius: 8px; border: 1px solid var(--border); text-transform: capitalize;">
                    📅 ${timeInfo.formattedDate} • ${b.time} hrs
                </span>
            </div>

            <h4 style="font-size: 17px; margin-bottom: 6px;">${b.clientName}</h4>
            <div class="booking-meta">
                <strong>Servicio:</strong> ${b.serviceName} ($${Number(b.servicePrice).toLocaleString('es-CL')})<br>
                <strong>Fecha exacta:</strong> ${b.date}<br>
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
