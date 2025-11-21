let grid = [];
let width = 10;
let height = 10;
let totalMines = 10;
let selectedTool = 'unknown';

document.addEventListener('DOMContentLoaded', () => {
    setupToolbar();
    resetBoard();
});

function setupToolbar() {
    const tools = document.querySelectorAll('.tool');
    tools.forEach(tool => {
        tool.addEventListener('click', () => {
            document.querySelector('.tool.active').classList.remove('active');
            tool.classList.add('active');
            selectedTool = tool.getAttribute('data-tool');
        });
    });
}

function resetBoard() {
    // Input değerlerini güvenli şekilde al
    const wInput = document.getElementById('width');
    const hInput = document.getElementById('height');
    const mInput = document.getElementById('totalMines');
    
    if(wInput) width = parseInt(wInput.value);
    if(hInput) height = parseInt(hInput.value);
    if(mInput) totalMines = parseInt(mInput.value);
    
    const boardEl = document.getElementById('board');
    if (!boardEl) return; // Hata koruması

    boardEl.style.gridTemplateColumns = `repeat(${width}, 30px)`;
    boardEl.innerHTML = '';
    grid = [];

    for (let y = 0; y < height; y++) {
        let row = [];
        for (let x = 0; x < width; x++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.x = x;
            cell.dataset.y = y;
            cell.dataset.state = 'unknown'; 
            
            cell.addEventListener('mousedown', (e) => handleCellClick(x, y, e));
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                toggleFlag(x, y);
            });

            boardEl.appendChild(cell);
            row.push({ element: cell, value: null, state: 'unknown' }); 
        }
        grid.push(row);
    }
    updateStatus("Tahta hazır. Durumu çizip 'Analiz Et'e basın.");
}

function handleCellClick(x, y, e) {
    const cellObj = grid[y][x];
    
    // Tıklanınca eski olasılıkları temizle
    clearProbabilities();

    if (selectedTool === 'flag') {
        cellObj.state = 'flag';
        cellObj.value = null;
    } else if (selectedTool === 'unknown') {
        cellObj.state = 'unknown';
        cellObj.value = null;
    } else {
        cellObj.state = 'safe';
        cellObj.value = parseInt(selectedTool);
    }
    renderCell(x, y);
}

function toggleFlag(x, y) {
    const cellObj = grid[y][x];
    if(cellObj.state === 'flag') {
        cellObj.state = 'unknown';
    } else {
        cellObj.state = 'flag';
    }
    cellObj.value = null;
    renderCell(x, y);
}

function renderCell(x, y) {
    const cellObj = grid[y][x];
    const el = cellObj.element;

    el.className = 'cell'; 
    el.innerText = '';
    delete el.dataset.val;

    if (cellObj.state === 'safe') {
        el.classList.add('open');
        if (cellObj.value > 0) {
            el.innerText = cellObj.value;
            el.dataset.val = cellObj.value;
        }
    } else if (cellObj.state === 'flag') {
        el.classList.add('flag');
        el.innerText = '🚩';
    }
}

function clearProbabilities() {
    document.querySelectorAll('.probability').forEach(el => el.remove());
}

// --- ANALİZ MOTORU VE VERİ GÖNDERİCİ ---

function analyzeBoard() {
    clearProbabilities();
    updateStatus("Hesaplanıyor...");

    let unknowns = [];
    let constraints = [];
    let knownMines = 0;

    // 1. Temel Hazırlık
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const cell = grid[y][x];
            
            if (cell.state === 'flag') knownMines++;
            
            if (cell.state === 'unknown') {
                unknowns.push({x, y, index: unknowns.length});
            }

            if (cell.state === 'safe' && cell.value > 0) {
                let neighbors = getNeighbors(x, y);
                let flagsAround = neighbors.filter(n => grid[n.y][n.x].state === 'flag').length;
                let unknownNeighbors = neighbors.filter(n => grid[n.y][n.x].state === 'unknown');
                
                let effectiveValue = cell.value - flagsAround;
                
                if (unknownNeighbors.length > 0) {
                    constraints.push({
                        x, y,
                        value: effectiveValue,
                        targets: unknownNeighbors
                    });
                }
            }
        }
    }

    // Basit hata kontrolleri
    for(let c of constraints) {
        if (c.value < 0) {
            updateStatus(`Hata: (${c.x},${c.y}) etrafında çok fazla bayrak var!`);
            return;
        }
        if (c.value > c.targets.length) {
            updateStatus(`Hata: (${c.x},${c.y}) etrafında yeterli boş alan yok!`);
            return;
        }
    }

    // 2. Sınır (Frontier) Ayrımı
    let frontierSet = new Set();
    constraints.forEach(c => {
        c.targets.forEach(t => frontierSet.add(`${t.x},${t.y}`));
    });

    let frontierCells = unknowns.filter(u => frontierSet.has(`${u.x},${u.y}`));
    let otherUnknowns = unknowns.filter(u => !frontierSet.has(`${u.x},${u.y}`));

    let validSolutions = 0;
    let mineCounts = new Array(frontierCells.length).fill(0);

    // 3. Recursive Backtracking
    function solve(index) {
        if (index === frontierCells.length) {
            validSolutions++;
            for(let i=0; i<frontierCells.length; i++) {
                if (frontierCells[i].isMine) mineCounts[i]++;
            }
            return;
        }

        let cell = frontierCells[index];

        // Dene: Mayın Var
        cell.isMine = true;
        if (isValidSoFar(cell)) solve(index + 1);

        // Dene: Mayın Yok
        cell.isMine = false;
        if (isValidSoFar(cell)) solve(index + 1);
        
        delete cell.isMine;
    }

    function isValidSoFar(changedCell) {
        for (let c of constraints) {
            let placedMines = 0;
            let undefinedCells = 0;
            let isRelevant = false;

            for (let t of c.targets) {
                let realCell = frontierCells.find(f => f.x === t.x && f.y === t.y);
                if (realCell) {
                    if (realCell === changedCell) isRelevant = true;
                    if (realCell.isMine === true) placedMines++;
                    else if (realCell.isMine === undefined) undefinedCells++;
                }
            }

            if (!isRelevant) continue;
            if (placedMines > c.value) return false;
            if (c.value > placedMines + undefinedCells) return false;
        }
        return true;
    }

    // 4. Asenkron Çalıştırma (Arayüzü dondurmamak için)
    setTimeout(() => {
        solve(0);

        // --- BURASI ÇOK ÖNEMLİ: SONUÇLARI TOPLAYIP GERİ YOLLUYORUZ ---
        let resultsToSend = []; 

        if (validSolutions === 0) {
            updateStatus("Hata: İmkansız konfigürasyon!");
            return;
        }

        // A) Frontier Sonuçları
        frontierCells.forEach((cell, i) => {
            let probability = (mineCounts[i] / validSolutions) * 100;
            
            // Kendi sitemizde göster
            showProbability(cell.x, cell.y, probability);
            
            // Oyun sitesine göndermek için listeye ekle
            resultsToSend.push({ x: cell.x, y: cell.y, percent: probability });
        });

        // B) Diğer (Arkada Kalan) Sonuçlar
        let avgFrontierMines = mineCounts.reduce((a,b)=>a+b, 0) / validSolutions;
        let remainingMines = totalMines - knownMines - avgFrontierMines;
        
        if (otherUnknowns.length > 0) {
            let otherProb = (remainingMines / otherUnknowns.length) * 100;
            otherProb = Math.max(0, Math.min(100, otherProb));
            
            otherUnknowns.forEach(cell => {
                showProbability(cell.x, cell.y, otherProb);
                resultsToSend.push({ x: cell.x, y: cell.y, percent: otherProb });
            });
        }

        updateStatus("Analiz bitti. Sonuçlar oyuna gönderildi.");

        // C) VERİYİ OYUN SİTESİNE POSTALA (Bu kısım eksikti)
        if (window.opener) {
            window.opener.postMessage({
                type: 'ANALYSIS_RESULT',
                data: resultsToSend
            }, '*');
        }

    }, 10);
}

function getNeighbors(x, y) {
    let neighbors = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            let nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                neighbors.push({x: nx, y: ny});
            }
        }
    }
    return neighbors;
}

function showProbability(x, y, percent) {
    const cellObj = grid[y][x];
    const el = cellObj.element;
    
    const probDiv = document.createElement('div');
    probDiv.className = 'probability';
    
    let roundedPercent = Math.round(percent);

    // --- RENK AYARLARI (DÜZELTİLDİ) ---
    const colorZero = '#FF0000';      // %0 -> Kırmızı (#FF0000)
    const colorHundred = '#000080';   // %100 -> Lacivert (#000080)
    const colorFill = '#4CAF50';      // Dolum -> Yeşil
    const colorEmpty = '#FFEB3B';     // Boşluk -> Sarı
    
    if (roundedPercent === 100) {
        // KESİN MAYIN
        probDiv.style.backgroundColor = colorHundred;
        probDiv.style.color = '#ffffff'; 
    } else if (roundedPercent === 0) {
        // KESİN GÜVENLİ
        probDiv.style.backgroundColor = colorZero;
        probDiv.style.color = '#ffffff'; 
    } else {
        // ARA DEĞERLER
        probDiv.style.background = `linear-gradient(to top, ${colorFill} ${percent}%, ${colorEmpty} ${percent}%)`;
        probDiv.style.color = '#000000'; 
    }
    
    probDiv.style.fontWeight = 'bold';
    if (roundedPercent > 0 && roundedPercent < 100) {
        probDiv.style.textShadow = '0px 0px 2px #fff'; 
    } else {
        probDiv.style.textShadow = 'none'; 
    }
    
    probDiv.style.display = 'flex';
    probDiv.style.alignItems = 'center';
    probDiv.style.justifyContent = 'center';
    probDiv.style.fontSize = '13px';
    probDiv.innerText = roundedPercent + '%';
    
    el.appendChild(probDiv);
}

function updateStatus(msg) {
    const st = document.getElementById('status');
    if(st) st.innerText = msg;
}

// --- VERİ ALICI (Oyun Sitesinden Gelen Veriyi Dinler) ---
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'SYNC_BOARD') return;

    const gameData = event.data.payload;
    
    // Değerleri güncelle
    const wInput = document.getElementById('width');
    const hInput = document.getElementById('height');
    const mInput = document.getElementById('totalMines');

    if(wInput) wInput.value = gameData.width;
    if(hInput) hInput.value = gameData.height;
    if(mInput) mInput.value = gameData.totalMines;
    
    width = gameData.width;
    height = gameData.height;
    totalMines = gameData.totalMines;

    // Tahtayı yeniden oluştur
    resetBoard();

    // Hücreleri doldur
    gameData.grid.forEach(row => {
        if(!row) return;
        row.forEach(cellData => {
            if (!cellData || cellData.status === 'unknown') return; 

            const cellObj = grid[cellData.y][cellData.x];
            
            if (cellData.status === 'flag') {
                cellObj.state = 'flag';
            } else if (cellData.status === 'safe') {
                cellObj.state = 'safe';
                cellObj.value = cellData.value;
            }
            
            renderCell(cellData.x, cellData.y);
        });
    });

    // Her veri geldiğinde analizi otomatik başlat
    analyzeBoard();
});
