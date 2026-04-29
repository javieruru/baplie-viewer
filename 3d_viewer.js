// ==================== VARIABLES GLOBALES ====================
let profiles = [];
let currentProfileId = null;
let editingProfileId = null;
let pendingConfirmAction = null;
let currentTool = 'active';

// Editor state
let editorProfile = null;      // profile siendo editado
let currentBayIndex = 0;       // índice del bay en el editor
let allBayKeys = [];            // lista de bay keys ordenados
let isDragging = false;         // para pintar arrastrando

// THREE.JS
let scene, camera, renderer;
let containerMeshes = [];

// ==================== INICIALIZACIÓN ====================
window.addEventListener('load', () => {
    initProfileStorage();
    loadProfiles();
});

// ==================== STORAGE ====================
function initProfileStorage() {
    if (!localStorage.getItem('shipProfiles')) {
        localStorage.setItem('shipProfiles', JSON.stringify([]));
    }
    profiles = JSON.parse(localStorage.getItem('shipProfiles'));
}

function saveProfileStorage() {
    localStorage.setItem('shipProfiles', JSON.stringify(profiles));
}

// ==================== CARGAR LISTA ====================
function loadProfiles() {
    const grid = document.getElementById('profilesGrid');
    if (profiles.length === 0) {
        grid.innerHTML = `
            <div class="empty-profiles" style="grid-column:1/-1;">
                <h3>No hay profiles cargados</h3>
                <p>Creá un nuevo profile para comenzar</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = profiles.map((p, i) => {
        const date = new Date(p.createdAt).toLocaleDateString('es-UY');
        const totalSlots = countActiveSlots(p);
        const bayCount = p.structure ? Object.keys(p.structure).length : 0;

        return `
            <div class="profile-card">
                <h3>🚢 ${p.name}</h3>
                <div class="profile-info"><strong>Eslora:</strong> ${p.length} m</div>
                <div class="profile-info"><strong>IMO:</strong> ${p.imo || '-'}</div>
                <div class="profile-tags">
                    <span class="tag tag-bay">${bayCount} bays</span>
                    <span class="tag tag-row">${p.config ? p.config.rowsPerSide * 2 + (p.config.hasCenter ? 1 : 0) : '-'} rows</span>
                    <span class="tag tag-tier">${totalSlots} slots activos</span>
                </div>
                <div class="profile-info"><strong>Creado:</strong> ${date}</div>
                <div class="profile-actions">
                    <button class="btn btn-info" onclick="openEditor(${i})">✏️ Editar</button>
                    <button class="btn btn-primary" onclick="viewProfile3D(${i})">🧊 3D</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteProfile(${i})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

function countActiveSlots(profile) {
    if (!profile.structure) return 0;
    let count = 0;
    Object.values(profile.structure).forEach(bay => {
        Object.values(bay).forEach(tier => {
            Object.values(tier).forEach(slotType => {
                if (slotType && slotType !== 'inactive') count++;
            });
        });
    });
    return count;
}

// ==================== PASO 1: INFO BÁSICA ====================
let step1Data = {};

function showAddProfileModal() {
    editingProfileId = null;
    step1Data = {};
    document.getElementById('p1Name').value = '';
    document.getElementById('p1Length').value = '';
    document.getElementById('p1Imo').value = '';
    document.getElementById('step1Title').textContent = '🚢 Nuevo Profile — Paso 1';
    document.getElementById('step1Modal').classList.add('active');
}

function closeStep1Modal() {
    document.getElementById('step1Modal').classList.remove('active');
}

function goToStep2() {
    const name = document.getElementById('p1Name').value.trim();
    const length = document.getElementById('p1Length').value;
    if (!name || !length) {
        alert('Completá nombre y eslora');
        return;
    }
    step1Data = {
        name,
        length: parseFloat(length),
        imo: document.getElementById('p1Imo').value.trim()
    };
    document.getElementById('step1Modal').classList.remove('active');
    document.getElementById('step2Modal').classList.add('active');
}

function backToStep1() {
    document.getElementById('step2Modal').classList.remove('active');
    document.getElementById('step1Modal').classList.add('active');
}

// ==================== PASO 2: ESTRUCTURA ====================
function generateProfile() {
    const bayFrom  = parseInt(document.getElementById('p2BayFrom').value);
    const bayTo    = parseInt(document.getElementById('p2BayTo').value);
    const rowsSide = parseInt(document.getElementById('p2Rows').value);
    const hasCenter = document.getElementById('p2HasCenter').checked;
    const holdTiers = parseInt(document.getElementById('p2HoldTiers').value);
    const deckStart = parseInt(document.getElementById('p2DeckStart').value);
    const deckTiers = parseInt(document.getElementById('p2DeckTiers').value);

    if (!bayFrom || !bayTo || bayTo < bayFrom || !rowsSide || !holdTiers || !deckTiers) {
        alert('Completá todos los campos de estructura');
        return;
    }

    // Generar rows
    const rows = [];
    for (let r = rowsSide; r >= 1; r--) {
        rows.push(String(r * 2).padStart(2, '0')); // babor: 02,04...
    }
    if (hasCenter) rows.push('00');
    for (let r = 1; r <= rowsSide; r++) {
        rows.push(String(r * 2 - 1).padStart(2, '0')); // estribor: 01,03...
    }

    // Generar tiers bodega
    const holdTierList = [];
    for (let t = 1; t <= holdTiers; t++) {
        holdTierList.push(String(t * 2).padStart(2, '0'));
    }

    // Generar tiers cubierta
    const deckTierList = [];
    for (let t = 0; t < deckTiers; t++) {
        deckTierList.push(String(deckStart + t * 2).padStart(2, '0'));
    }

    // Generar estructura de bays
    const structure = {};
    for (let b = bayFrom; b <= bayTo; b += 1) {
        const bayKey = String(b).padStart(3, '0');
        structure[bayKey] = {};

        // Hold tiers
        holdTierList.forEach(tier => {
            structure[bayKey][`H${tier}`] = {};
            rows.forEach(row => {
                structure[bayKey][`H${tier}`][row] = 'active';
            });
        });

        // Deck tiers
        deckTierList.forEach(tier => {
            structure[bayKey][`D${tier}`] = {};
            rows.forEach(row => {
                structure[bayKey][`D${tier}`][row] = 'active';
            });
        });
    }

    const config = { bayFrom, bayTo, rowsSide, hasCenter, holdTiers, holdTierList, deckStart, deckTiers, deckTierList, rows };

    const profileData = {
        id: editingProfileId !== null ? profiles[editingProfileId].id : Date.now(),
        name: step1Data.name,
        length: step1Data.length,
        imo: step1Data.imo,
        config,
        structure,
        createdAt: editingProfileId !== null ? profiles[editingProfileId].createdAt : new Date().toISOString()
    };

    if (editingProfileId !== null) {
        profiles[editingProfileId] = profileData;
    } else {
        profiles.push(profileData);
    }

    saveProfileStorage();
    loadProfiles();
    document.getElementById('step2Modal').classList.remove('active');

    // Abrir editor de slots directamente
    const idx = editingProfileId !== null ? editingProfileId : profiles.length - 1;
    openEditor(idx);
    editingProfileId = null;
}

// ==================== EDITOR DE SLOTS ====================
function openEditor(index) {
    editorProfile = JSON.parse(JSON.stringify(profiles[index]));
    currentProfileId = index;

    document.getElementById('editorTitle').textContent = `✏️ ${editorProfile.name}`;

    // Generar lista de bays
    allBayKeys = Object.keys(editorProfile.structure).sort();
    currentBayIndex = 0;

    populateBaySelect();
    loadBayEditor(allBayKeys[0]);

    document.getElementById('profilesSection').style.display = 'none';
    document.getElementById('editorSection').classList.add('active');
}

function openEditorFromViewer() {
    document.getElementById('viewerSection').classList.remove('active');
    openEditor(currentProfileId);
}

function populateBaySelect() {
    const sel = document.getElementById('baySelect');
    const copySel = document.getElementById('copyFromBay');
    sel.innerHTML = allBayKeys.map(k => `<option value="${k}">BAY ${k}</option>`).join('');
    copySel.innerHTML = allBayKeys.map(k => `<option value="${k}">BAY ${k}</option>`).join('');
}

function prevBayEditor() {
    if (currentBayIndex > 0) {
        currentBayIndex--;
        document.getElementById('baySelect').value = allBayKeys[currentBayIndex];
        loadBayEditor(allBayKeys[currentBayIndex]);
    }
}

function nextBayEditor() {
    if (currentBayIndex < allBayKeys.length - 1) {
        currentBayIndex++;
        document.getElementById('baySelect').value = allBayKeys[currentBayIndex];
        loadBayEditor(allBayKeys[currentBayIndex]);
    }
}

function loadBayEditor(bayKey) {
    currentBayIndex = allBayKeys.indexOf(bayKey);
    const bay = editorProfile.structure[bayKey];
    const config = editorProfile.config;
    const editor = document.getElementById('bayEditor');

    // Separar tiers hold y deck
    const holdTiers = config.holdTierList.slice().reverse(); // de mayor a menor para mostrar
    const deckTiers = config.deckTierList.slice().reverse();
    const rows = config.rows;

    let html = `<div class="bay-editor-title">BAY ${bayKey} — ${parseInt(bayKey) % 2 === 0 ? "40'" : "20'"}</div>`;

    // Render cubierta
    html += `<div class="slot-section-title">🌊 Cubierta (Deck)</div>`;
    html += renderBayGrid(bayKey, bay, deckTiers, rows, 'D');

    // Render bodega
    html += `<div class="slot-section-title" style="margin-top:16px;">⚓ Bodega (Hold)</div>`;
    html += renderBayGrid(bayKey, bay, holdTiers, rows, 'H');

    editor.innerHTML = html;

    // Eventos de mouse para pintar arrastrando
    editor.querySelectorAll('.slot').forEach(slot => {
        slot.addEventListener('mousedown', (e) => {
            isDragging = true;
            toggleSlot(slot);
            e.preventDefault();
        });
        slot.addEventListener('mouseover', () => {
            if (isDragging) toggleSlot(slot);
        });
    });

    document.addEventListener('mouseup', () => { isDragging = false; });
}

function renderBayGrid(bayKey, bay, tiers, rows, prefix) {
    let html = `<div class="bay-grid-wrapper">`;

    // Labels tiers izquierda
    html += `<div class="tier-labels">`;
    tiers.forEach(t => {
        html += `<div class="tier-label">${t}</div>`;
    });
    html += `</div>`;

    html += `<div>`;

    // Labels rows arriba
    html += `<div class="row-labels">`;
    rows.forEach(r => {
        html += `<div class="row-label ${r === '00' ? 'center' : ''}">${r}</div>`;
    });
    html += `</div>`;

    // Grid de slots
    html += `<div class="slots-grid">`;
    tiers.forEach(tier => {
        const tierKey = `${prefix}${tier}`;
        html += `<div class="slots-row">`;
        rows.forEach(row => {
            const slotType = (bay[tierKey] && bay[tierKey][row]) ? bay[tierKey][row] : 'inactive';
            const centerClass = row === '00' ? 'center-col' : '';
            html += `<div class="slot ${slotType} ${centerClass}" 
                         data-bay="${bayKey}" 
                         data-tier="${tierKey}" 
                         data-row="${row}">
                     </div>`;
        });
        html += `</div>`;
    });
    html += `</div>`;
    html += `</div>`;

    // Labels tiers derecha
    html += `<div class="tier-labels">`;
    tiers.forEach(t => {
        html += `<div class="tier-label">${t}</div>`;
    });
    html += `</div>`;

    html += `</div>`;
    return html;
}

function toggleSlot(slotEl) {
    const bay  = slotEl.dataset.bay;
    const tier = slotEl.dataset.tier;
    const row  = slotEl.dataset.row;

    if (!editorProfile.structure[bay][tier]) {
        editorProfile.structure[bay][tier] = {};
    }

    const current = editorProfile.structure[bay][tier][row] || 'inactive';

    // Si la herramienta es borrar o el slot ya tiene ese tipo, lo borramos
    if (currentTool === 'inactive' || current === currentTool) {
        editorProfile.structure[bay][tier][row] = 'inactive';
        slotEl.className = slotEl.className.replace(/active[\w-]*/g, '').replace(/funnel/g, '').replace(/inactive/g, '').trim() + ' inactive';
        // Limpiar center-col y re-agregar
        if (row === '00') slotEl.classList.add('center-col');
        slotEl.classList.add('inactive');
    } else {
        editorProfile.structure[bay][tier][row] = currentTool;
        slotEl.className = `slot ${currentTool} ${row === '00' ? 'center-col' : ''}`;
    }
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
    const btn = document.getElementById(`tool_${tool}`);
    if (btn) btn.classList.add('active-tool');
}

function copyFromBay() {
    const fromKey = document.getElementById('copyFromBay').value;
    const toKey = allBayKeys[currentBayIndex];
    if (fromKey === toKey) return;

    if (!confirm(`¿Copiar la estructura de BAY ${fromKey} a BAY ${toKey}? Se sobreescribirá el bay actual.`)) return;

    editorProfile.structure[toKey] = JSON.parse(JSON.stringify(editorProfile.structure[fromKey]));
    loadBayEditor(toKey);
}

function saveEditorAndBack() {
    profiles[currentProfileId] = editorProfile;
    saveProfileStorage();
    loadProfiles();
    backToProfilesFromEditor();
}

function backToProfilesFromEditor() {
    document.getElementById('editorSection').classList.remove('active');
    document.getElementById('profilesSection').style.display = 'block';
    editorProfile = null;
}

// ==================== VISTA 3D ====================
function viewProfile3D(index) {
    currentProfileId = index;
    const profile = profiles[index];

    document.getElementById('currentProfileName').textContent = profile.name;
    document.getElementById('statVessel').textContent = profile.name;
    document.getElementById('statLength').textContent = profile.length;
    document.getElementById('statBays').textContent = Object.keys(profile.structure || {}).length;
    document.getElementById('statSlots').textContent = countActiveSlots(profile);

    document.getElementById('profilesSection').style.display = 'none';
    document.getElementById('viewerSection').classList.add('active');

    if (!scene) initScene();
    buildShipFrom3D(profile);
}

function backToProfiles() {
    document.getElementById('viewerSection').classList.remove('active');
    document.getElementById('profilesSection').style.display = 'block';
    currentProfileId = null;
    if (scene) {
        containerMeshes.forEach(m => scene.remove(m));
        containerMeshes = [];
    }
}

// ==================== THREE.JS ====================
function initScene() {
    const container = document.getElementById('viewerSection');
    const canvas = document.getElementById('canvas3d');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 80, 300);

    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(80, 50, 80);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 80, 30);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const grid = new THREE.GridHelper(200, 40, 0x667eea, 0x333355);
    scene.add(grid);

    setupControls();
    animate();
}

function buildShipFrom3D(profile) {
    containerMeshes.forEach(m => scene.remove(m));
    containerMeshes = [];

    if (!profile.structure) return;

    const showDeck  = document.getElementById('showDeck').checked;
    const showHold  = document.getElementById('showHold').checked;
    const showEmpty = document.getElementById('showEmpty').checked;

    const bayKeys = Object.keys(profile.structure).sort();

    bayKeys.forEach((bayKey, bayIdx) => {
        const bay = profile.structure[bayKey];
        const x = (bayIdx - bayKeys.length / 2) * 3.2;

        Object.keys(bay).forEach(tierKey => {
            const isHold = tierKey.startsWith('H');
            const isDeck = tierKey.startsWith('D');

            if (isHold && !showHold) return;
            if (isDeck && !showDeck) return;

            const tierNum = parseInt(tierKey.substring(1));
            const y = isHold ? (tierNum / 2) * 2.4 : 10 + ((tierNum - 80) / 2) * 2.4;

            Object.keys(bay[tierKey]).forEach(row => {
                const slotType = bay[tierKey][row];
                if (!slotType || slotType === 'inactive') return;

                const rowNum = parseInt(row);
                const z = (rowNum % 2 === 0 ? rowNum / 2 : -(rowNum + 1) / 2) * 2.6;

                const isBay40 = parseInt(bayKey) % 2 === 0;
                const width = isBay40 ? 5.8 : 2.7;

                const geometry = new THREE.BoxGeometry(width, 2.2, 2.4);

                let color = 0x4CAF50;
                if (slotType === 'active-reefer') color = 0x17a2b8;
                else if (slotType === 'active-imo') color = 0xffc107;
                else if (slotType === 'funnel')     color = 0xdc3545;
                else if (slotType === 'inactive')   { if (!showEmpty) return; color = 0x888888; }

                const material = new THREE.MeshPhongMaterial({ color, shininess: 40, opacity: slotType === 'inactive' ? 0.3 : 1, transparent: slotType === 'inactive' });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(x, y, z);
                mesh.castShadow = true;

                const edges = new THREE.EdgesGeometry(geometry);
                const lineMat = new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.4, transparent: true });
                mesh.add(new THREE.LineSegments(edges, lineMat));

                scene.add(mesh);
                containerMeshes.push(mesh);
            });
        });
    });
}

function setupControls() {
    let isDragging3D = false;
    let prevMouse = { x: 0, y: 0 };
    let isRight = false;
    const canvas = document.getElementById('canvas3d');

    canvas.addEventListener('mousedown', (e) => {
        isDragging3D = true;
        isRight = e.button === 2;
        prevMouse = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging3D) return;
        const dx = e.clientX - prevMouse.x;
        const dy = e.clientY - prevMouse.y;

        if (isRight) {
            const right = new THREE.Vector3();
            camera.getWorldDirection(right);
            right.cross(new THREE.Vector3(0, 1, 0)).normalize();
            camera.position.addScaledVector(right, -dx * 0.05);
            camera.position.y -= dy * 0.05;
        } else {
            const sph = new THREE.Spherical();
            sph.setFromVector3(camera.position);
            sph.theta -= dx * 0.005;
            sph.phi = Math.max(0.1, Math.min(Math.PI - 0.1, sph.phi + dy * 0.005));
            camera.position.setFromSpherical(sph);
            camera.lookAt(0, 0, 0);
        }
        prevMouse = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mouseup', () => { isDragging3D = false; });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, -e.deltaY * 0.02);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function animate() {
    requestAnimationFrame(animate);
    if (document.getElementById('autoRotate').checked) {
        camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.005);
        camera.lookAt(0, 0, 0);
    }
    if (renderer) renderer.render(scene, camera);
}

function resetCamera() {
    camera.position.set(80, 50, 80);
    camera.lookAt(0, 0, 0);
}

function exportImage() {
    document.getElementById('canvas3d').toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ship_3d_${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

// ==================== ELIMINAR PROFILE ====================
function deleteProfile(index) {
    pendingConfirmAction = () => {
        profiles.splice(index, 1);
        saveProfileStorage();
        loadProfiles();
    };
    document.getElementById('confirmTitle').textContent = '¿Eliminar Profile?';
    document.getElementById('confirmMessage').textContent = `Se eliminará "${profiles[index].name}" permanentemente.`;
    document.getElementById('confirmModal').classList.add('active');
}

function deleteCurrentProfile() {
    if (currentProfileId !== null) deleteProfile(currentProfileId);
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    pendingConfirmAction = null;
}

function executeConfirmAction() {
    if (pendingConfirmAction) {
        pendingConfirmAction();
        pendingConfirmAction = null;
    }
    closeConfirmModal();
    if (document.getElementById('viewerSection').classList.contains('active')) {
        backToProfiles();
    }
}

// ==================== NAVEGACIÓN ====================
function backToIndex() {
    window.location.href = 'index.html';
}

// ==================== RESIZE ====================
window.addEventListener('resize', () => {
    if (camera && renderer) {
        const container = document.getElementById('viewerSection');
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
});

// ==================== LISTENER 3D CONTROLS ====================
document.getElementById('showDeck').addEventListener('change',  () => { if (currentProfileId !== null) buildShipFrom3D(profiles[currentProfileId]); });
document.getElementById('showHold').addEventListener('change',  () => { if (currentProfileId !== null) buildShipFrom3D(profiles[currentProfileId]); });
document.getElementById('showEmpty').addEventListener('change', () => { if (currentProfileId !== null) buildShipFrom3D(profiles[currentProfileId]); });
