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

    // Si la imagen es un Base64 subido por archivo, evitamos llenar la casilla con el texto gigante
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
