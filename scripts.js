// ==================== VARIABLES GLOBALES ====================
let baplies = []; // Array de todos los BAPLIEs guardados
let currentBaplieIndex = null; // Índice del BAPLIE actual en vista
let containersData = [];
let originalData = [];
let rawEDI = '';
let editMode = false;
let filters = {};
let sortColumn = null;
let sortDirection = 'asc';
let vesselName = '';
let pendingDeleteAction = null;

// ==================== INICIALIZACIÓN ====================
window.addEventListener('load', () => {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';

    initBaplieStorage();
    loadBaplieList();
    setupFileInputs();
});

// ==================== GESTIÓN DE STORAGE ====================
function initBaplieStorage() {
    if (!localStorage.getItem('baplies')) {
        localStorage.setItem('baplies', JSON.stringify([]));
    }
    baplies = JSON.parse(localStorage.getItem('baplies'));
}

function saveBaplieStorage() {
    localStorage.setItem('baplies', JSON.stringify(baplies));
}

// ==================== SETUP DE INPUTS ====================
function setupFileInputs() {
    // Input de la lista
    const fileInputList = document.getElementById('fileInputList');
    if (fileInputList) {
        fileInputList.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) processNewFile(file);
        });
    }
}

// ==================== CARGAR LISTA DE BAPLIES ====================
function loadBaplieList() {
    const tbody = document.getElementById('baplieListBody');

    if (baplies.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-message">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                    </svg>
                    <h3>No hay BAPLIEs cargados</h3>
                    <p>Carga un archivo BAPLIE para comenzar</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = baplies.map((baplie, index) => {
        const date = new Date(baplie.timestamp).toLocaleDateString('es-UY');
        return `
            <tr>
                <td><strong>${baplie.fileName}</strong></td>
                <td>${baplie.vesselName}</td>
                <td><strong>${baplie.totalContainers}</strong></td>
                <td style="color: #dc3545; font-weight: 600;">${baplie.dischargeUYMVD}</td>
                <td style="color: #28a745; font-weight: 600;">${baplie.loadUYMVD}</td>
                <td>${date}</td>
                <td>
                    <button class="btn btn-info btn-icon" onclick="viewBaplie(${index})" title="Ver detalle">
                        🔍
                    </button>
                    <button class="btn btn-danger btn-icon" onclick="deleteBaplieFromList(${index})" title="Eliminar">
                        🗑️
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== PROCESAR NUEVO ARCHIVO ====================
function processNewFile(file) {
    showLoading();
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const content = e.target.result;
            const baplieData = parseBALPIEToObject(content, file.name);

            baplies.push(baplieData);
            saveBaplieStorage();
            loadBaplieList();

            showNotification('¡Guardado!', 'Cambios guardados correctamente', 'success');
            document.getElementById('fileInputList').value = '';
        } catch (error) {
            alert('❌ Error al procesar archivo: ' + error.message);
        } finally {
            hideLoading();
        }
    };
    reader.onerror = () => hideLoading();
    reader.readAsText(file);
}

// ==================== PARSEAR BAPLIE A OBJETO ====================
function parseBALPIEToObject(content, fileName) {
    // ── Normalización: el EDI puede venir todo en una línea con ' como
    //    terminador de segmento (EDIFACT estándar) o con saltos de línea reales.
    //    Dividimos por ' y también por \n para cubrir ambos formatos.
    const rawSegments = content
        .replace(/\r/g, '')          // quitar CR
        .split(/['\n]/)              // separar por ' o \n
        .map(s => s.trim())
        .filter(s => s.length > 2);  // descartar fragmentos vacíos / demasiado cortos

    const containers = [];
    const parseWarnings = [];        // ← registro de discrepancias
    let currentContainer = null;
    let vesselName = '';
    let segmentCount = 0;
    let containerCount = 0;

    // ── Extraer nombre del buque desde TDT
    //    Formatos posibles:
    //      TDT+20+918N+++ZIM:172:20+++9348065:146:11:TIGER GAUCHO
    //      TDT+20+XXX++:::::VESSEL NAME
    const tdtSeg = rawSegments.find(s => s.startsWith('TDT+20'));
    if (tdtSeg) {
        // Buscar el último grupo de : en el último campo de +
        const tdtParts = tdtSeg.split('+');
        let found = false;
        // Recorrer partes de derecha a izquierda buscando un campo con nombre
        for (let p = tdtParts.length - 1; p >= 0; p--) {
            const subParts = tdtParts[p].split(':');
            const candidate = subParts[subParts.length - 1].trim();
            if (candidate && candidate.length > 1 && /[A-Za-z]/.test(candidate)) {
                vesselName = candidate;
                found = true;
                break;
            }
        }
        if (!found) vesselName = 'Unknown Vessel';
    } else {
        vesselName = 'Unknown Vessel';
        parseWarnings.push({ type: 'error', msg: 'No se encontró segmento TDT+20 — nombre del buque desconocido.' });
    }

    // Función auxiliar: guarda el contenedor actual si es válido
    function flushContainer() {
        if (!currentContainer) return;
        if (!currentContainer.posicion) {
            parseWarnings.push({ type: 'warning', msg: `Contenedor sin posición ignorado (número: ${currentContainer.numero || 'S/N'})` });
            return;
        }
        // Validaciones de negocio
        if (!currentContainer.numero) {
            parseWarnings.push({ type: 'warning', msg: `Posición ${currentContainer.posicion}: contenedor sin número de equipo (EQD no encontrado).` });
        }
        if (!currentContainer.peso) {
            parseWarnings.push({ type: 'info', msg: `Contenedor ${currentContainer.numero || currentContainer.posicion}: sin peso VGM.` });
        }
        if (!currentContainer.pol) {
            parseWarnings.push({ type: 'warning', msg: `Contenedor ${currentContainer.numero || currentContainer.posicion}: sin LOC+9 (POL).` });
        }
        if (!currentContainer.pod) {
            parseWarnings.push({ type: 'warning', msg: `Contenedor ${currentContainer.numero || currentContainer.posicion}: sin LOC+11 (POD).` });
        }
        containers.push({ ...currentContainer });
        containerCount++;
    }

    // ── Iterar segmentos
    for (let i = 0; i < rawSegments.length; i++) {
        const seg = rawSegments[i];
        segmentCount++;
        const tag = seg.substring(0, 3);

        // --- LOC+147 → inicio de un nuevo contenedor ---
        if (tag === 'LOC' && seg.includes('+147+')) {
            flushContainer();
            currentContainer = {
                posicion: '', bay: '', row: '', tier: '',
                numero: '', isoCode: '', tamaño: '', tipo: '',
                peso: '', setpoint: '', humedad: '', ventilacion: '',
                pol: '', pod: '', descarga: '', booking: '', slotOperator: '',
                peligroso: '', imdg: '', unNumber: '', descripcion: ''
            };
            const parts = seg.split('+');
            if (parts[2]) {
                const posParts = parts[2].split(':');
                const fullPos = posParts[0].replace(/'/g, '').trim();
                currentContainer.posicion = fullPos;
                if (fullPos.length >= 6) {
                    currentContainer.bay  = fullPos.substring(0, 3);
                    currentContainer.row  = fullPos.substring(3, 5);
                    currentContainer.tier = fullPos.substring(5, 7);
                } else {
                    parseWarnings.push({ type: 'warning', msg: `LOC+147 con posición inválida: "${fullPos}"` });
                }
            }
            continue;
        }

        if (!currentContainer) continue; // segmentos de cabecera, ignorar

        // --- EQD → número e ISO del contenedor ---
        if (tag === 'EQD' && seg.includes('+CN+')) {
            const parts = seg.split('+');
            currentContainer.numero  = (parts[2] || '').replace(/'/g, '').trim();
            currentContainer.isoCode = (parts[3] || '').replace(/'/g, '').trim();
            const iso = currentContainer.isoCode;
            if (iso.length >= 2) {
                const f2 = iso.substring(0, 2);
                if      (f2 === '22' || f2 === '2C') currentContainer.tamaño = "20'";
                else if (f2 === '42' || f2 === '45' || f2 === '4C' || f2 === '4G') currentContainer.tamaño = "40'";
                else if (f2 === '46' || f2 === 'L5') currentContainer.tamaño = "45'";
                else    currentContainer.tamaño = iso.startsWith('2') ? "20'" : "40'";

                if      (iso[2] === 'R' || iso.endsWith('R1') || iso.endsWith('R9') || iso === '4532' || iso === '45R1') currentContainer.tipo = 'Reefer';
                else if (iso[2] === 'U') currentContainer.tipo = 'Open Top';
                else if (iso[2] === 'P') currentContainer.tipo = 'Flat Rack';
                else    currentContainer.tipo = 'Standard';
            }
            continue;
        }

        // --- MEA+VGM → peso bruto ---
        // Formatos: MEA+VGM++KGM:15663  |  MEA+WT+VGM+KGM:15663
        if (tag === 'MEA' && seg.includes('VGM')) {
            const parts = seg.split('+');
            // Buscar el componente que contenga "KGM:" o sea numérico
            for (let p = parts.length - 1; p >= 0; p--) {
                if (parts[p].includes('KGM:') || parts[p].includes('LBR:')) {
                    const w = parts[p].split(':')[1];
                    if (w) { currentContainer.peso = w.replace(/'/g, '').trim(); break; }
                } else if (parts[p].includes(':')) {
                    const candidate = parts[p].split(':').find(v => /^\d+$/.test(v.trim()));
                    if (candidate) { currentContainer.peso = candidate.trim(); break; }
                }
            }
            continue;
        }

        // --- TMP → setpoint reefer ---
        if (tag === 'TMP') {
            const parts = seg.split('+');
            if (parts[2]) {
                const tempParts = parts[2].split(':');
                const val = parseFloat(tempParts[0]);
                if (!isNaN(val)) {
                    currentContainer.setpoint = val > 0 ? `+${val}` : `${val}`;
                }
            }
            continue;
        }

        // --- RNG → humedad ---
        if (tag === 'RNG' && seg.includes('+5+')) {
            const parts = seg.split('+');
            if (parts[2]) currentContainer.humedad = parts[2].replace(/'/g, '').trim();
            continue;
        }

        // --- FTX → ventilación o descripción ---
        if (tag === 'FTX') {
            const parts = seg.split('+');
            if (seg.includes('+VEN')) {
                currentContainer.ventilacion = (parts[4] || parts[3] || '').replace(/'/g, '').trim();
            } else {
                currentContainer.descripcion = (parts[4] || parts[3] || '').replace(/'/g, '').trim();
            }
            continue;
        }

        // --- LOC+9 → POL ---
        if (tag === 'LOC' && seg.includes('+9+')) {
            const parts = seg.split('+');
            if (parts[2]) currentContainer.pol = parts[2].split(':')[0].replace(/'/g, '').trim();
            continue;
        }

        // --- LOC+11 → POD ---
        if (tag === 'LOC' && seg.includes('+11+')) {
            const parts = seg.split('+');
            if (parts[2]) currentContainer.pod = parts[2].split(':')[0].replace(/'/g, '').trim();
            continue;
        }

        // --- LOC+83 → Puerto de descarga ---
        if (tag === 'LOC' && seg.includes('+83+')) {
            const parts = seg.split('+');
            if (parts[2]) currentContainer.descarga = parts[2].split(':')[0].replace(/'/g, '').trim();
            continue;
        }

        // --- RFF+BM → booking ---
        if (tag === 'RFF' && seg.includes('+BM:')) {
            const colon = seg.indexOf(':');
            if (colon !== -1) {
                currentContainer.booking = seg.substring(colon + 1).replace(/'/g, '').trim();
            }
            continue;
        }

        // --- NAD+CA → slot operator ---
        if (tag === 'NAD' && seg.includes('+CA+')) {
            const parts = seg.split('+');
            if (parts[2]) currentContainer.slotOperator = parts[2].split(':')[0].replace(/'/g, '').trim();
            continue;
        }

        // --- DGS → mercancía peligrosa ---
        if (tag === 'DGS') {
            currentContainer.peligroso = 'Sí';
            const parts = seg.split('+');
            if (parts[2]) currentContainer.imdg     = parts[2].replace(/'/g, '').trim();
            if (parts[3]) currentContainer.unNumber  = parts[3].replace(/'/g, '').trim();
            continue;
        }
    }

    // Guardar el último contenedor
    flushContainer();

    // ── Validaciones globales
    if (containers.length === 0) {
        parseWarnings.push({ type: 'error', msg: `No se encontró ningún contenedor válido. Segmentos procesados: ${segmentCount}. Verificar formato del archivo.` });
    }

    const posiciones = containers.map(c => c.posicion);
    const duplicados = posiciones.filter((p, i) => posiciones.indexOf(p) !== i);
    if (duplicados.length > 0) {
        const uniq = [...new Set(duplicados)];
        parseWarnings.push({ type: 'error', msg: `Posiciones duplicadas detectadas: ${uniq.join(', ')}` });
    }

    const sinISO = containers.filter(c => !c.isoCode).length;
    if (sinISO > 0) parseWarnings.push({ type: 'warning', msg: `${sinISO} contenedores sin código ISO.` });

    const sinPeso = containers.filter(c => !c.peso).length;
    if (sinPeso > 0) parseWarnings.push({ type: 'info', msg: `${sinPeso} contenedores sin peso VGM declarado.` });

    const reefers = containers.filter(c => c.tipo === 'Reefer');
    const sinSetpoint = reefers.filter(c => !c.setpoint).length;
    if (sinSetpoint > 0) parseWarnings.push({ type: 'warning', msg: `${sinSetpoint} reefers sin setpoint de temperatura.` });

    const sinPOD = containers.filter(c => !c.pod).length;
    if (sinPOD > 0) parseWarnings.push({ type: 'warning', msg: `${sinPOD} contenedores sin POD (LOC+11).` });

    const dischargeUYMVD = containers.filter(c => c.descarga === 'UYMVD').length;
    const loadUYMVD      = containers.filter(c => c.pol === 'UYMVD').length;

    return {
        id: Date.now(),
        fileName: fileName,
        vesselName: vesselName,
        totalContainers: containers.length,
        dischargeUYMVD: dischargeUYMVD,
        loadUYMVD: loadUYMVD,
        timestamp: new Date().toISOString(),
        rawEDI: content,
        parseWarnings: parseWarnings,
        containers: containers.map((c, i) => ({ id: i + 1, ...c }))
    };
}

// ==================== VER DETALLE DE BAPLIE ====================
function viewBaplie(index) {
    currentBaplieIndex = index;
    const baplie = baplies[index];

    containersData = baplie.containers;
    originalData = JSON.parse(JSON.stringify(containersData));
    rawEDI = baplie.rawEDI;
    vesselName = baplie.vesselName;

    document.getElementById('detailTitle').textContent = `${baplie.vesselName}`;
    document.getElementById('baplieListSection').style.display = 'none';
    document.getElementById('contentSection').style.display = 'flex';

    renderTable();
    showStats();
    document.getElementById('tableFooter').classList.add('active');

    // Panel de diagnóstico
    renderDiagnosticsPanel(baplie.parseWarnings || []);
}

// ==================== PANEL DE DIAGNÓSTICO ====================
function renderDiagnosticsPanel(warnings) {
    const existing = document.getElementById('diagnosticsPanel');
    if (existing) existing.remove();
    if (!warnings || warnings.length === 0) return;

    const errors = warnings.filter(w => w.type === 'error');
    const warns  = warnings.filter(w => w.type === 'warning');
    const infos  = warnings.filter(w => w.type === 'info');

    const panel = document.createElement('div');
    panel.id = 'diagnosticsPanel';
    panel.className = 'diagnostics-panel';

    const badges = [
        errors.length > 0 ? `<span class="diag-badge diag-error">${errors.length} error${errors.length > 1 ? 'es' : ''}</span>` : '',
        warns.length  > 0 ? `<span class="diag-badge diag-warning">${warns.length} aviso${warns.length > 1 ? 's' : ''}</span>` : '',
        infos.length  > 0 ? `<span class="diag-badge diag-info">${infos.length} info</span>` : ''
    ].join('');

    panel.innerHTML = `
        <div class="diag-header" onclick="toggleDiagnosticsPanel()">
            <span>🔍 Diagnóstico de carga &nbsp;${badges}</span>
            <button class="diag-toggle" id="diagToggleBtn">▼ Ver detalles</button>
        </div>
        <div class="diag-body" id="diagBody" style="display:none;">
            ${warnings.map(w => `
                <div class="diag-item diag-${w.type}">
                    <span class="diag-icon">${w.type === 'error' ? '❌' : w.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                    <span>${w.msg}</span>
                </div>
            `).join('')}
        </div>
    `;

    const contentSection = document.getElementById('contentSection');
    const controls = contentSection.querySelector('.controls');
    contentSection.insertBefore(panel, controls);
}

function toggleDiagnosticsPanel() {
    const body = document.getElementById('diagBody');
    const btn  = document.getElementById('diagToggleBtn');
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    btn.textContent    = open ? '▲ Ocultar' : '▼ Ver detalles';
}

// ==================== EXPORTAR / IMPORTAR BD ====================
function exportBapliesJSON() {
    if (baplies.length === 0) {
        showNotification('Atención', 'No hay BAPLIEs para exportar', 'warning');
        return;
    }
    const blob = new Blob([JSON.stringify(baplies, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `baplies_db_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('¡Exportado!', `${baplies.length} BAPLIE(s) exportados correctamente`, 'success');
}

function importBapliesJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) throw new Error('Formato inválido.');
            const existingIds = new Set(baplies.map(b => b.id));
            let added = 0;
            imported.forEach(b => { if (!existingIds.has(b.id)) { baplies.push(b); added++; } });
            saveBaplieStorage();
            loadBaplieList();
            showNotification('¡Importado!', `${added} BAPLIE(s) nuevos importados.`, 'success');
        } catch (err) {
            showNotification('Error', 'No se pudo importar: ' + err.message, 'error');
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

// ==================== VOLVER A LISTA ====================
function backToList() {
    // Guardar cambios si hubo ediciones
    if (currentBaplieIndex !== null) {
        baplies[currentBaplieIndex].containers = containersData;
        baplies[currentBaplieIndex].rawEDI = rawEDI;
        saveBaplieStorage();
    }

    // Limpiar panel de diagnóstico
    const dp = document.getElementById('diagnosticsPanel');
    if (dp) dp.remove();

    document.getElementById('contentSection').style.display = 'none';
    document.getElementById('baplieListSection').style.display = 'flex';
    document.getElementById('tableFooter').classList.remove('active');

    if (editMode) {
        editMode = false;
        document.getElementById('btnEditar').style.display = 'inline-block';
        document.getElementById('btnGuardar').style.display = 'none';
        document.getElementById('btnCancelar').style.display = 'none';
    }

    currentBaplieIndex = null;
    containersData = [];
    originalData = [];
    rawEDI = '';
    vesselName = '';
    filters = {};
    sortColumn = null;
    sortDirection = 'asc';

    loadBaplieList();
}

// ==================== ELIMINAR BAPLIE DE LA LISTA ====================
function deleteBaplieFromList(index) {
    pendingDeleteAction = () => {
        baplies.splice(index, 1);
        saveBaplieStorage();
        loadBaplieList();
    };

    showDeleteModal(
        '¿Eliminar BAPLIE?',
        `Se eliminará el archivo "${baplies[index].fileName}" y todos sus datos.`
    );
}

// ==================== ELIMINAR BAPLIE ACTUAL ====================
function confirmDeleteCurrent() {
    if (currentBaplieIndex === null) return;

    pendingDeleteAction = () => {
        baplies.splice(currentBaplieIndex, 1);
        saveBaplieStorage();

        currentBaplieIndex = null;
        containersData = [];
        originalData = [];
        rawEDI = '';
        vesselName = '';

        document.getElementById('contentSection').style.display = 'none';
        document.getElementById('baplieListSection').style.display = 'flex';
        document.getElementById('tableFooter').classList.remove('active');

        loadBaplieList();
    };

    showDeleteModal(
        '¿Eliminar este BAPLIE?',
        'Se eliminará este archivo y volverás a la lista principal.'
    );
}

// ==================== MODAL DE CONFIRMACIÓN ====================
function showDeleteModal(title, message) {
    document.getElementById('deleteModalTitle').textContent = title;
    document.getElementById('deleteModalMessage').textContent = message;
    document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    pendingDeleteAction = null;
}

function executeDelete() {
    if (pendingDeleteAction) {
        pendingDeleteAction();
        pendingDeleteAction = null;
    }
    closeDeleteModal();
}

// ==================== LOADING ====================
function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300);
    }, 500);
}

// ==================== RENDER TABLA ====================
function renderTable() {
    const thead = document.getElementById('tableHeader');
    const filterRow = document.getElementById('filterRow');
    const tbody = document.getElementById('tableBody');

    if (containersData.length === 0) return;

    const headers = Object.keys(containersData[0]);

    // Columnas con ancho fijo compacto
    const colWidths = {
        id: '40px',
        posicion: '80px',
        bay: '45px',
        row: '45px',
        tier: '45px',
        numero: '120px',
        isoCode: '70px',
        tamaño: '55px',
        tipo: '80px',
        peso: '70px',
        setpoint: '70px',
        humedad: '70px',
        ventilacion: '80px',
        pol: '60px',
        pod: '60px',
        descarga: '70px',
        booking: '100px',
        slotOperator: '90px',
        peligroso: '75px',
        imdg: '60px',
        unNumber: '80px',
        descripcion: '150px',
    };

    thead.innerHTML = headers.map(key => {
        const isId = key === 'id';
        const width = colWidths[key] || '90px';
        if (isId) {
            return `<th style="width:${width}; min-width:${width}; cursor:default;">
                        ${key.toUpperCase()}
                    </th>`;
        }
        return `<th onclick="sortTable('${key}')" style="width:${width}; min-width:${width};">
                    ${key.toUpperCase()}
                    <span class="sort-icon">${sortColumn === key ? (sortDirection === 'asc' ? '▲' : '▼') : '⇅'}</span>
                </th>`;
    }).join('');

    // DESPUÉS
    // DESPUÉS
    filterRow.innerHTML = headers.map(key => {
        const isId = key === 'id';
        const width = colWidths[key] || '90px';
        if (isId) {
            return `<th style="width:${width}; min-width:${width};">
                    <span class="filter-label-id">Filtrar...</span>
                </th>`;
        }
        return `<th style="width:${width}; min-width:${width}; position:relative;">
                <input 
                    type="text" 
                    class="filter-input" 
                    placeholder=""
                    data-col="${key}"
                    onkeyup="filterColumn('${key}', this.value)"
                >
            </th>`;
    }).join('');

    tbody.innerHTML = containersData.map((row) => {
        const isDangerous = row.peligroso === 'Sí';
        const isReefer = row.setpoint && row.setpoint !== '';
        const rowClass = isDangerous ? 'dangerous' : (isReefer ? 'reefer' : '');
        return `
            <tr class="${rowClass}">
                ${headers.map(key => {
            const width = colWidths[key] || '90px';
            return `<td style="width:${width}; min-width:${width};">${row[key] || ''}</td>`;
        }).join('')}
            </tr>
        `;
    }).join('');
}

// ==================== ESTADÍSTICAS ====================
function showStats() {
    const total = containersData.length;
    const dangerous = containersData.filter(c => c.peligroso === 'Sí').length;
    const reefers = containersData.filter(c => c.setpoint && c.setpoint !== '').length;
    const empty = containersData.filter(c => {
        const peso = parseFloat(c.peso);
        return !c.peso || peso === 0 || isNaN(peso);
    }).length;
    const totalWeight = containersData.reduce((sum, c) => {
        const peso = parseFloat(c.peso);
        return sum + (isNaN(peso) ? 0 : peso);
    }, 0);
    const tons = (totalWeight / 1000).toFixed(2);

    document.getElementById('footerTotal').textContent = total;
    document.getElementById('footerWeight').textContent = `${tons} t`;
    document.getElementById('footerEmpty').textContent = empty;
    document.getElementById('footerReefers').textContent = reefers;
    document.getElementById('footerImos').textContent = dangerous;
    document.getElementById('footerVessel').textContent = vesselName;
}

// ==================== EDICIÓN ====================
function toggleEditMode() {
    editMode = !editMode;
    const btnEditar = document.getElementById('btnEditar');
    const btnGuardar = document.getElementById('btnGuardar');
    const btnCancelar = document.getElementById('btnCancelar');

    if (editMode) {
        btnEditar.style.display = 'none';
        btnGuardar.style.display = 'inline-block';
        btnCancelar.style.display = 'inline-block';
        makeTableEditable();
        showNotification('Modo Edición', 'Modo edición masiva activado', 'info');
    } else {
        btnEditar.style.display = 'inline-block';
        btnGuardar.style.display = 'none';
        btnCancelar.style.display = 'none';
        renderTable();
    }
}

function makeTableEditable() {
    const tbody = document.getElementById('tableBody');
    const headers = Object.keys(containersData[0]);

    tbody.innerHTML = containersData.map((row, i) => {
        const isDangerous = row.peligroso === 'Sí';
        const isReefer = row.setpoint && row.setpoint !== '';
        const rowClass = isDangerous ? 'dangerous' : (isReefer ? 'reefer' : '');

        return `
            <tr class="${rowClass}">
                ${headers.map((key, j) => `
                    <td>
                        <input 
                            type="text" 
                            value="${row[key] || ''}" 
                            data-row="${i}" 
                            data-col="${j}" 
                            class="edit-inline-input"
                        >
                    </td>
                `).join('')}
            </tr>
        `;
    }).join('');
}

function saveChanges() {
    const inputs = document.querySelectorAll('.edit-inline-input');
    inputs.forEach(input => {
        const rowIndex = parseInt(input.dataset.row);
        const colIndex = parseInt(input.dataset.col);
        const keys = Object.keys(containersData[rowIndex]);
        containersData[rowIndex][keys[colIndex]] = input.value;
    });

    originalData = JSON.parse(JSON.stringify(containersData));

    // Guardar en storage
    if (currentBaplieIndex !== null) {
        baplies[currentBaplieIndex].containers = containersData;
        saveBaplieStorage();
    }

    toggleEditMode();
    showStats();
    showNotification('¡Guardado!', 'Cambios guardados correctamente', 'success');
}

function cancelEdit() {
    containersData = JSON.parse(JSON.stringify(originalData));
    toggleEditMode();
}

// ==================== EDICIÓN INDIVIDUAL ====================
document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
        tableBody.addEventListener('dblclick', (e) => {
            if (editMode) return;
            const row = e.target.closest('tr');
            if (!row) return;
            const rowIndex = Array.from(row.parentNode.children).indexOf(row);
            openEditModal(rowIndex);
        });
    }
});

function openEditModal(rowIndex) {
    const row = containersData[rowIndex];
    const keys = Object.keys(row);
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'editModal';
    const excludeFields = ['id', 'descripcion'];

    modal.innerHTML = `
        <div class="edit-modal-content">
            <h3>✏️ Editar Contenedor</h3>
            <div class="edit-form">
                ${keys.filter(key => !excludeFields.includes(key.toLowerCase())).map(key => {
        const isTamano = key.toLowerCase() === 'tamaño';
        if (isTamano) {
            return `
                            <div class="edit-field">
                                <label>${key.toUpperCase()}:</label>
                                <select id="edit_${key}" class="edit-modal-input">
                                    <option value="20'" ${row[key] === "20'" ? 'selected' : ''}>20'</option>
                                    <option value="40'" ${row[key] === "40'" ? 'selected' : ''}>40'</option>
                                    <option value="45'" ${row[key] === "45'" ? 'selected' : ''}>45'</option>
                                </select>
                            </div>
                        `;
        } else {
            return `
                            <div class="edit-field">
                                <label>${key.toUpperCase()}:</label>
                                <input 
                                    type="text" 
                                    id="edit_${key}" 
                                    value="${row[key] || ''}"
                                    class="edit-modal-input"
                                >
                            </div>
                        `;
        }
    }).join('')}
            </div>
            <div class="modal-buttons">
                <button class="btn btn-secondary" onclick="closeEditModal()">❌ Cancelar</button>
                <button class="btn btn-success" onclick="saveEditModal(${rowIndex})">💾 Guardar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.remove();
}

function saveEditModal(rowIndex) {
    const keys = Object.keys(containersData[rowIndex]);
    const excludeFields = ['id', 'descripcion'];

    keys.forEach(key => {
        if (excludeFields.includes(key.toLowerCase())) return;
        const input = document.getElementById(`edit_${key}`);
        if (input) {
            containersData[rowIndex][key] = input.value;
        }
    });

    originalData = JSON.parse(JSON.stringify(containersData));

    // Guardar en storage
    if (currentBaplieIndex !== null) {
        baplies[currentBaplieIndex].containers = containersData;
        saveBaplieStorage();
    }

    renderTable();
    showStats();
    closeEditModal();
    showNotification('¡Guardado!', 'Cambios guardados correctamente', 'success');
}

// ==================== EXPORTAR ====================
function exportEDI() {
    if (!rawEDI) {
        showNotification('Atención', 'No hay datos EDI para exportar', 'warning');
        return;
    }
    const blob = new Blob([rawEDI], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BAPLIE_${vesselName}_${new Date().toISOString().split('T')[0]}.edi`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function exportExcel() {
    if (containersData.length === 0) {
        showNotification('Atención', 'No hay datos para exportar', 'warning');
        return;
    }

    let csv = Object.keys(containersData[0]).join(',') + '\n';
    containersData.forEach(row => {
        csv += Object.values(row).map(val => `"${val}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BAPLIE_${vesselName}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// ==================== ORDENAR ====================
function sortTable(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }

    containersData.sort((a, b) => {
        let valA = a[column] || '';
        let valB = b[column] || '';
        const numA = parseFloat(valA);
        const numB = parseFloat(valB);

        if (!isNaN(numA) && !isNaN(numB)) {
            return sortDirection === 'asc' ? numA - numB : numB - numA;
        }

        valA = valA.toString().toLowerCase();
        valB = valB.toString().toLowerCase();
        if (sortDirection === 'asc') {
            return valA > valB ? 1 : valA < valB ? -1 : 0;
        } else {
            return valA < valB ? 1 : valA > valB ? -1 : 0;
        }
    });

    renderTable();
}

// ==================== FILTROS ====================
// DESPUÉS
function filterColumn(column, value) {
    filters[column] = value.toLowerCase();
    applyFiltersOnly();
}

function applyFiltersOnly() {
    const filtered = originalData.filter(row => {
        return Object.keys(filters).every(key => {
            if (!filters[key]) return true;
            const cellValue = (row[key] || '').toString().toLowerCase();
            return cellValue.includes(filters[key]);
        });
    });

    containersData = filtered;

    // Solo actualiza tbody, sin tocar thead ni filterRow
    const headers = Object.keys(originalData[0]);
    const colWidths = {
        id: '40px', posicion: '80px', bay: '45px', row: '45px', tier: '45px',
        numero: '120px', isoCode: '70px', tamaño: '55px', tipo: '80px',
        peso: '70px', setpoint: '70px', humedad: '70px', ventilacion: '80px',
        pol: '60px', pod: '60px', descarga: '70px', booking: '100px',
        slotOperator: '90px', peligroso: '75px', imdg: '60px',
        unNumber: '80px', descripcion: '150px',
    };

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = filtered.map(row => {
        const isDangerous = row.peligroso === 'Sí';
        const isReefer = row.setpoint && row.setpoint !== '';
        const rowClass = isDangerous ? 'dangerous' : (isReefer ? 'reefer' : '');
        return `<tr class="${rowClass}">
            ${headers.map(key => {
            const width = colWidths[key] || '90px';
            return `<td style="width:${width}; min-width:${width};">${row[key] || ''}</td>`;
        }).join('')}
        </tr>`;
    }).join('');

    // Actualiza estilos del input activo sin tocar el DOM
    document.querySelectorAll('.filter-input').forEach(input => {
        const col = input.dataset.col;
        if (!col) return;
        const val = filters[col] || '';

        if (val) {
            input.classList.add('filter-active');
        } else {
            input.classList.remove('filter-active');
        }

        let clearBtn = input.parentNode.querySelector('.filter-clear');
        if (val && !clearBtn) {
            clearBtn = document.createElement('span');
            clearBtn.className = 'filter-clear';
            clearBtn.textContent = '✕';
            clearBtn.onclick = () => clearSingleFilter(col);
            input.parentNode.appendChild(clearBtn);
        } else if (!val && clearBtn) {
            clearBtn.remove();
        }
    });

    showStats();
}

// DESPUÉS
function applyFilters() {
    containersData = originalData.filter(row => {
        return Object.keys(filters).every(key => {
            if (!filters[key]) return true;
            const cellValue = (row[key] || '').toString().toLowerCase();
            return cellValue.includes(filters[key]);
        });
    });
    renderTable();
    showStats();
}

// DESPUÉS
function restoreFilterInputs() {
    const active = document.activeElement;
    const activeCol = active && active.dataset ? active.dataset.col : null;
    const activeCursor = active ? active.selectionStart : null;

    document.querySelectorAll('.filter-input').forEach(input => {
        const col = input.dataset.col;
        if (!col) return;
        const val = filters[col] || '';
        input.value = val;

        if (val) {
            input.classList.add('filter-active');
        } else {
            input.classList.remove('filter-active');
        }

        let clearBtn = input.parentNode.querySelector('.filter-clear');
        if (val && !clearBtn) {
            clearBtn = document.createElement('span');
            clearBtn.className = 'filter-clear';
            clearBtn.textContent = '✕';
            clearBtn.onclick = () => clearSingleFilter(col);
            input.parentNode.appendChild(clearBtn);
        } else if (!val && clearBtn) {
            clearBtn.remove();
        }

        // Restaurar foco y posición del cursor
        if (col === activeCol) {
            input.focus();
            if (activeCursor !== null) {
                input.setSelectionRange(activeCursor, activeCursor);
            }
        }
    });
}

function clearSingleFilter(col) {
    delete filters[col];
    applyFilters();
}

// DESPUÉS
function clearFilters() {
    filters = {};
    containersData = JSON.parse(JSON.stringify(originalData));
    const globalSearch = document.getElementById('globalSearch');
    if (globalSearch) globalSearch.value = '';
    renderTable();
    showStats();
    // Los inputs se recrean limpios con renderTable, no hace falta limpiarlos manualmente
}

// DESPUÉS
function globalSearch(value) {
    const searchTerm = value.toLowerCase();
    if (!searchTerm) {
        containersData = JSON.parse(JSON.stringify(originalData));
    } else {
        containersData = originalData.filter(row => {
            return Object.values(row).some(val =>
                (val || '').toString().toLowerCase().includes(searchTerm)
            );
        });
    }

    const headers = Object.keys(originalData[0]);
    const colWidths = {
        id: '40px', posicion: '80px', bay: '45px', row: '45px', tier: '45px',
        numero: '120px', isoCode: '70px', tamaño: '55px', tipo: '80px',
        peso: '70px', setpoint: '70px', humedad: '70px', ventilacion: '80px',
        pol: '60px', pod: '60px', descarga: '70px', booking: '100px',
        slotOperator: '90px', peligroso: '75px', imdg: '60px',
        unNumber: '80px', descripcion: '150px',
    };

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = containersData.map(row => {
        const isDangerous = row.peligroso === 'Sí';
        const isReefer = row.setpoint && row.setpoint !== '';
        const rowClass = isDangerous ? 'dangerous' : (isReefer ? 'reefer' : '');
        return `<tr class="${rowClass}">
            ${headers.map(key => {
            const width = colWidths[key] || '90px';
            return `<td style="width:${width}; min-width:${width};">${row[key] || ''}</td>`;
        }).join('')}
        </tr>`;
    }).join('');

    showStats();
}

// ==================== BAY PLAN ====================
function openBayPlan() {
    if (containersData.length === 0) {
        showNotification('Atención', 'No hay datos para exportar', 'warning');
        return;
    }

    document.getElementById('bayPlanVessel').textContent = vesselName;
    document.getElementById('bayPlanModal').style.display = 'flex';
    renderBayPlan();
}

function closeBayPlan() {
    document.getElementById('bayPlanModal').style.display = 'none';
}

function renderBayPlan() {
    const container = document.getElementById('bayPlanContainer');
    const showEmpty = document.getElementById('showEmptyBayPlan').checked;
    const showDeck = document.getElementById('showDeckBayPlan').checked;
    const showHold = document.getElementById('showHoldBayPlan').checked;
    const deckStart = parseInt(document.getElementById('deckStartTier').value);

    const allBays = [...new Set(containersData.map(c => c.bay).filter(b => b))].sort();

    if (allBays.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:40px;">No hay bays disponibles</p>';
        return;
    }

    const rows = [
        '20', '18', '16', '14', '12', '10', '08', '06', '04', '02',
        '00',
        '01', '03', '05', '07', '09', '11', '13', '15', '17', '19'
    ];

    const holdTiers = ['20', '18', '16', '14', '12', '10', '08', '06', '04', '02'];

    const deckTiers = [];
    for (let i = 9; i >= 0; i--) {
        deckTiers.push(String(deckStart + (i * 2)).padStart(2, '0'));
    }

    let html = `
        <div class="bayplan-navigation">
            <button class="btn btn-secondary" id="prevBay" onclick="changeBay(-1)">◀ Anterior</button>
            <span id="currentBayLabel" style="font-weight: bold; font-size: 18px; margin: 0 20px;">BAY ${allBays[0]}</span>
            <button class="btn btn-secondary" id="nextBay" onclick="changeBay(1)">Siguiente ▶</button>
        </div>
    `;

    allBays.forEach((bayNum, index) => {
        const bayContainers = containersData.filter(c => c.bay === bayNum);
        html += `<div class="bay-view" id="bay_${bayNum}" style="display: ${index === 0 ? 'block' : 'none'};">`;

        if (showDeck) {
            html += `
                <div class="bay-section">
                    <div class="bay-title">🌊 CUBIERTA (DECK) - BAY ${bayNum}</div>
                    <div class="tier-grid-container">
                        <div class="tier-labels-left">
                            ${deckTiers.map(t => `<div class="tier-label">${t}</div>`).join('')}
                        </div>
                        <div>
                            <div class="row-labels-top">
                                ${rows.map(r => `<div class="row-label ${r === '00' ? 'center-row' : ''}">${r}</div>`).join('')}
                            </div>
                            <div class="bay-grid" style="grid-template-columns: repeat(${rows.length}, 70px); grid-template-rows: repeat(${deckTiers.length}, 60px);">
            `;

            deckTiers.forEach(tier => {
                rows.forEach(row => {
                    const cont = bayContainers.find(c => c.row === row && c.tier === tier);
                    html += renderCell(cont, showEmpty, row);
                });
            });

            html += `</div></div><div class="tier-labels-right">${deckTiers.map(t => `<div class="tier-label">${t}</div>`).join('')}</div></div></div>`;
        }

        if (showHold) {
            html += `
                <div class="bay-section">
                    <div class="bay-title">⚓ BODEGA (HOLD) - BAY ${bayNum}</div>
                    <div class="tier-grid-container">
                        <div class="tier-labels-left">
                            ${holdTiers.map(t => `<div class="tier-label">${t}</div>`).join('')}
                        </div>
                        <div>
                            <div class="row-labels-top">
                                ${rows.map(r => `<div class="row-label ${r === '00' ? 'center-row' : ''}">${r}</div>`).join('')}
                            </div>
                            <div class="bay-grid" style="grid-template-columns: repeat(${rows.length}, 70px); grid-template-rows: repeat(${holdTiers.length}, 60px);">
            `;

            holdTiers.forEach(tier => {
                rows.forEach(row => {
                    const cont = bayContainers.find(c => c.row === row && c.tier === tier);
                    html += renderCell(cont, showEmpty, row);
                });
            });

            html += `</div></div><div class="tier-labels-right">${holdTiers.map(t => `<div class="tier-label">${t}</div>`).join('')}</div></div></div>`;
        }

        html += `</div>`;
    });

    container.innerHTML = html;
    window.currentBayIndex = 0;
    window.allBays = allBays;
    updateBayButtons();
}

function renderCell(cont, showEmpty, row) {
    if (cont) {
        const isEmpty = !cont.peso || parseFloat(cont.peso) === 0;
        if (!showEmpty && isEmpty) {
            return `<div class="bay-cell empty-slot ${row === '00' ? 'center-column' : ''}"></div>`;
        }

        const isDangerous = cont.peligroso === 'Sí';
        const isReefer = cont.setpoint && cont.setpoint !== '';
        const cellClass = isEmpty ? 'empty' : (isDangerous ? 'dangerous' : (isReefer ? 'reefer' : 'standard'));

        return `
            <div class="bay-cell ${cellClass} ${row === '00' ? 'center-column' : ''}" 
                 title="${cont.numero}\n${cont.tamaño} ${cont.tipo}\nPeso: ${cont.peso}kg\nPOL: ${cont.pol} → POD: ${cont.pod}"
                 onclick="showContainerDetail('${cont.numero}')">
                <span class="container-number">${cont.numero.substring(cont.numero.length - 6)}</span>
                <span class="container-size">${cont.tamaño}</span>
            </div>
        `;
    } else {
        return `<div class="bay-cell empty-slot ${row === '00' ? 'center-column' : ''}"></div>`;
    }
}

function changeBay(direction) {
    window.currentBayIndex += direction;
    if (window.currentBayIndex < 0) window.currentBayIndex = 0;
    if (window.currentBayIndex >= window.allBays.length) window.currentBayIndex = window.allBays.length - 1;

    document.querySelectorAll('.bay-view').forEach(view => view.style.display = 'none');
    const currentBay = window.allBays[window.currentBayIndex];
    document.getElementById(`bay_${currentBay}`).style.display = 'block';
    document.getElementById('currentBayLabel').textContent = `BAY ${currentBay}`;
    updateBayButtons();
}

function updateBayButtons() {
    const prevBtn = document.getElementById('prevBay');
    const nextBtn = document.getElementById('nextBay');
    if (prevBtn) prevBtn.disabled = window.currentBayIndex === 0;
    if (nextBtn) nextBtn.disabled = window.currentBayIndex === window.allBays.length - 1;
}

// DESPUÉS
function showContainerDetail(numero) {
    const cont = containersData.find(c => c.numero === numero);
    if (!cont) return;

    const rows = [
        { icon: '📦', label: 'Número', value: cont.numero },
        { icon: '📏', label: 'Tamaño', value: cont.tamaño },
        { icon: '📍', label: 'Posición', value: cont.posicion },
        { icon: '⚖️', label: 'Peso', value: cont.peso ? `${cont.peso} kg` : '-' },
        { icon: '🏷️', label: 'Tipo', value: cont.tipo },
        { icon: '🚢', label: 'POL → POD', value: `${cont.pol} → ${cont.pod}` },
    ];

    if (cont.peligroso === 'Sí') {
        rows.push({ icon: '⚠️', label: 'IMDG', value: cont.imdg });
        rows.push({ icon: '🔢', label: 'UN', value: cont.unNumber });
    }

    if (cont.setpoint) {
        rows.push({ icon: '❄️', label: 'Temp.', value: `${cont.setpoint} °C` });
    }

    document.getElementById('containerDetailGrid').innerHTML = rows.map(r => `
        <div class="detail-row">
            <span class="detail-icon">${r.icon}</span>
            <span class="detail-label">${r.label}</span>
            <span class="detail-value">${r.value || '-'}</span>
        </div>
    `).join('');

    document.getElementById('containerDetailModal').style.display = 'flex';
}

// ==================== VISTA 3D ====================
function open3DViewer() {
    window.open('3d_viewer.html');
}


// ==================== SISTEMA DE NOTIFICACIONES ====================
function showNotification(title, message, type = 'info') {
    const modal = document.getElementById('notificationModal');
    if (!modal) {
        console.error('Modal de notificación no encontrado');
       console.error(title + ': ' + message);
        return;
    }

    const icon = document.getElementById('notificationIcon');
    const titleEl = document.getElementById('notificationTitle');
    const messageEl = document.getElementById('notificationMessage');

    // Configurar icono según el tipo
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: '💡'
    };

    icon.textContent = icons[type] || icons.info;
    icon.className = 'notification-icon ' + type;

    titleEl.textContent = title;
    messageEl.textContent = message;

    modal.classList.add('active');
}

function closeNotificationModal() {
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// ==================== PROCESAR NUEVO ARCHIVO (CORREGIDO) ====================
function processNewFile(file) {
    showLoading();
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const content = e.target.result;
            const baplieData = parseBALPIEToObject(content, file.name);

            baplies.push(baplieData);
            saveBaplieStorage();
            loadBaplieList();

            showNotification('¡Éxito!', 'BAPLIE cargado correctamente', 'success');
            document.getElementById('fileInputList').value = '';
        } catch (err) {
            console.error('Error al procesar archivo:', err);
            showNotification('Error', 'Error al procesar archivo: ' + err.message, 'error');
        } finally {
            hideLoading();
        }
    };

    reader.onerror = (err) => {
        console.error('Error al leer archivo:', err);
        showNotification('Error', 'Error al leer el archivo', 'error');
        hideLoading();
    };

    reader.readAsText(file);
}