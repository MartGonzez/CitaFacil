// Renderizar datos del perfil y mini-landing
document.getElementById('business-name').textContent = currentTenant.name || 'Agenda de Citas';
document.getElementById('business-address').textContent = currentTenant.address ? `📍 ${currentTenant.address}` : '📍 Santiago, Chile';
document.getElementById('business-description').textContent = currentTenant.description || 'Bienvenido a nuestra agenda online. Reserva tu hora en segundos.';

// Logo o Emoji
if (currentTenant.logoUrl) {
    const logoEl = document.getElementById('business-logo');
    if (currentTenant.logoUrl.startsWith('http')) {
        logoEl.innerHTML = `<img src="${currentTenant.logoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
        logoEl.textContent = currentTenant.logoUrl;
    }
}

// Banner de portada
if (currentTenant.coverUrl) {
    document.getElementById('hero-banner').style.backgroundImage = `url('${currentTenant.coverUrl}')`;
}

// Galería de fotos (si existen)
if (currentTenant.photos && currentTenant.photos.length > 0) {
    const galleryGrid = document.getElementById('gallery-grid');
    galleryGrid.innerHTML = '';
    currentTenant.photos.forEach(url => {
        if(url.trim()) {
            const img = document.createElement('img');
            img.src = url.trim();
            galleryGrid.appendChild(img);
        }
    });
    document.getElementById('gallery-section').classList.remove('hidden');
}

// Instagram opcional
if (currentTenant.instagram) {
    document.getElementById('social-links').innerHTML = `
        <a href="https://instagram.com/${currentTenant.instagram}" target="_blank">📸 @${currentTenant.instagram}</a>
    `;
}
