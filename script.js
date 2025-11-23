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
    const wInput = document.getElementById('width');
    const hInput = document.getElementById('height');
    const mInput = document.getElementById('totalMines');
    
    if(wInput) width = parseInt(wInput.value) || 30;
    if(hInput) height = parseInt(hInput.value) || 16;
    if(mInput) totalMines = parseInt(mInput.value) || 99;
    
    const boardEl = document.getElementById('board');
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
            row.push({ element: cell, value: null, state: 'unknown', x: x, y: y });
        }
        grid.push(row);
    }
    updateStatus("Tahta hazır. Durumu çizip 'Analiz Et'e basın.");
}

function handleCellClick(x, y, e) {
    const cellObj = grid[y][x];
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

function updateStatus(msg) {
    const st = document.getElementById('status');
    if(st) st.innerText = msg;
}

// --- OPTİMİZE EDİLMİŞ ANALİZ MOTORU ---

function analyzeBoard() {
    clearProbabilities();
    updateStatus("Analiz ediliyor...");

    // "setTimeout" kullanıyoruz ki UI çizilsin, donma hissi olmasın
    setTimeout(() => {
        runSolver();
    }, 20);
}

function runSolver() {
    let unknowns = [];
    let constraints = [];
    let knownMines = 0;

    // 1. Verileri Topla
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const cell = grid[y][x];
            if (cell.state === 'flag') knownMines++;
            
            if (cell.state === 'unknown') {
                // Solver için geçici bir ID atıyoruz
                cell.solverId = unknowns.length;
                unknowns.push(cell);
            }

            if (cell.state === 'safe' && cell.value > 0) {
                let neighbors = getNeighbors(x, y);
                let flagCount = 0;
                let unknownNeighbors = [];
                
                neighbors.forEach(n => {
                    let neighborCell = grid[n.y][n.x];
                    if (neighborCell.state === 'flag') flagCount++;
                    if (neighborCell.state === 'unknown') unknownNeighbors.push(neighborCell);
                });

                let effectiveValue = cell.value - flagCount;
                
                // Eğer constraint geçerliyse (etrafında bilinmeyen varsa) ekle
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

    // Hata Kontrolü
    for(let c of constraints) {
        if (c.value < 0) { updateStatus("Hata: Bir sayıda fazla bayrak var!"); return; }
        if (c.value > c.targets.length) { updateStatus("Hata: Sayı için yeterli boşluk yok!"); return; }
    }

    // 2. Sınır (Frontier) Tespiti ve Kümeleme (Clustering)
    // Tüm haritayı tek seferde çözmek yerine, birbirini etkileyen küçük adaları bulacağız.
    
    let frontierCells = new Set();
    constraints.forEach(c => {
        c.targets.forEach(t => frontierCells.add(t));
    });
    
    let frontierArray = Array.from(frontierCells);
    let otherUnknowns = unknowns.filter(u => !frontierCells.has(u));

    // Hücre -> Constraint haritası (Hangi hücre hangi sayılara bağlı?)
    let cellToConstraints = new Map();
    frontierArray.forEach(cell => cellToConstraints.set(cell, []));
    
    constraints.forEach(c => {
        c.targets.forEach(t => {
            if(cellToConstraints.has(t)) {
                cellToConstraints.get(t).push(c);
            }
        });
    });

    // Kümeleri Bul (Union-Find veya BFS ile)
    let clusters = [];
    let visited = new Set();

    frontierArray.forEach(startCell => {
        if (visited.has(startCell)) return;

        let cluster = [];
        let queue = [startCell];
        visited.add(startCell);

        while(queue.length > 0) {
            let current = queue.shift();
            cluster.push(current);

            // Bu hücreye bağlı constraintleri bul
            let relatedConstraints = cellToConstraints.get(current) || [];
            
            // Bu constraintlere bağlı diğer hücreleri bul
            relatedConstraints.forEach(c => {
                c.targets.forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push(neighbor);
                    }
                });
            });
        }
        clusters.push(cluster);
    });

    // 3. Her Kümeyi Ayrı Ayrı Çöz
    let totalSolutionsCount = 0; // Global istatistik hesabı için karmaşık, şimdilik yerel çözüyoruz.
    let minMinesTotal = 0;
    let maxMinesTotal = 0;
    let solvedMines = 0; // Çözülen kümelerden gelen ortalama mayın sayısı

    // Sonuçları saklamak için map
    let cellProbabilities = new Map(); 

    for (let cluster of clusters) {
        // Bu kümeye ait constraintleri filtrele
        let clusterSet = new Set(cluster);
        let clusterConstraints = constraints.filter(c => 
            c.targets.some(t => clusterSet.has(t))
        );

        // Backtracking Çözücü
        let solutions = solveCluster(cluster, clusterConstraints);
        
        if (solutions.length === 0) {
            updateStatus("Hata: İmkansız konfigürasyon!");
            return;
        }

        // Olasılıkları hesapla
        let mineCounts = new Array(cluster.length).fill(0);
        solutions.forEach(sol => {
            sol.forEach((isMine, idx) => {
                if(isMine) mineCounts[idx]++;
            });
        });

        // Bu kümedeki her hücre için olasılığı kaydet
        cluster.forEach((cell, idx) => {
            let prob = (mineCounts[idx] / solutions.length) * 100;
            cellProbabilities.set(cell, prob);
        });

        // İstatistik (Toplam mayın tahmini için)
        let minesInCluster = solutions.map(s => s.filter(x=>x).length);
        let avgMines = minesInCluster.reduce((a,b)=>a+b,0) / minesInCluster.length;
        solvedMines += avgMines;
    }

    // 4. Sonuçları Ekrana Bas
    cellProbabilities.forEach((prob, cell) => {
        showProbability(cell.x, cell.y, prob);
    });

    // 5. Geriye Kalan (Sınıra değmeyen) Hücreler
    // (Toplam Mayın - Bilinen Bayraklar - Sınırda Çıkan Tahmini Mayınlar) / Kalan Boşluklar
    let remainingMines = totalMines - knownMines - solvedMines;
    
    if (otherUnknowns.length > 0) {
        // Kalan mayın sayısı eksiye düşerse 0 kabul et (veya hata var demektir)
        if (remainingMines < 0) remainingMines = 0;
        
        let otherProb = (remainingMines / otherUnknowns.length) * 100;
        otherProb = Math.max(0, Math.min(100, otherProb)); // %0-100 arası sınırla

        otherUnknowns.forEach(cell => {
            showProbability(cell.x, cell.y, otherProb);
        });
    }

    updateStatus("Analiz tamamlandı.");
}

// --- YENİ BACKTRACKING ÇÖZÜCÜ (KÜME BAZLI) ---
function solveCluster(cells, constraints) {
    let solutions = [];
    let currentAssignment = new Array(cells.length).fill(undefined);
    
    // Constraintleri optimize et: Her constraint hangi indexteki hücreleri ilgilendiriyor?
    let optimizedConstraints = constraints.map(c => ({
        value: c.value,
        targetIndices: c.targets.map(t => cells.indexOf(t)).filter(i => i !== -1)
    }));

    function recurse(index) {
        if (index === cells.length) {
            solutions.push([...currentAssignment]);
            return;
        }

        // Hücre: cells[index]
        // Dene: Mayın YOK (False)
        currentAssignment[index] = false;
        if (isValid(index)) {
            recurse(index + 1);
        }

        // Dene: Mayın VAR (True)
        currentAssignment[index] = true;
        if (isValid(index)) {
            recurse(index + 1);
        }
        
        currentAssignment[index] = undefined;
    }

    function isValid(uptoIndex) {
        // Sadece değişen hücreyle ilgili constraintlere bakmak en iyisi ama
        // basitlik için bu kümedeki tüm constraintleri hızlıca tarayalım.
        // Zaten küme küçük olduğu için çok hızlı olacak.
        
        for (let c of optimizedConstraints) {
            let mineCount = 0;
            let undefinedCount = 0;
            
            // Bu constraintin ilgilendiği hücrelere bak
            for (let idx of c.targetIndices) {
                if (currentAssignment[idx] === true) mineCount++;
                else if (currentAssignment[idx] === undefined) undefinedCount++;
            }

            // Eğer koyulan mayınlar sayıyı aştıysa -> GEÇERSİZ
            if (mineCount > c.value) return false;
            
            // Eğer kalan boşluklar sayıyı tamamlamaya yetmiyorsa -> GEÇERSİZ
            if (mineCount + undefinedCount < c.value) return false;
        }
        return true;
    }

    recurse(0);
    return solutions;
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
    
    // Eski yazıyı sil
    const old = el.querySelector('.probability');
    if(old) old.remove();

    const probDiv = document.createElement('div');
    probDiv.className = 'probability';
    
    let rounded = Math.round(percent);
    if (rounded < 0) rounded = 0;
    if (rounded > 100) rounded = 100;

    // Renkler
    if (rounded === 100) {
        probDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.8)'; // Kırmızı (Bomba)
        probDiv.style.color = 'white';
    } else if (rounded === 0) {
        probDiv.style.backgroundColor = 'rgba(0, 0, 255, 0.6)'; // Mavi (Güvenli)
        probDiv.style.color = 'white';
    } else {
        // %0 Yeşil -> %100 Sarı/Turuncu/Kırmızı
        let hue = 120 - (rounded * 1.2); 
        probDiv.style.background = `linear-gradient(135deg, hsl(${hue}, 100%, 40%), hsl(${hue}, 100%, 30%))`;
        probDiv.style.color = 'white';
        probDiv.style.textShadow = '1px 1px 2px black';
    }
    
    probDiv.style.position = 'absolute';
    probDiv.style.width = '100%';
    probDiv.style.height = '100%';
    probDiv.style.display = 'flex';
    probDiv.style.alignItems = 'center';
    probDiv.style.justifyContent = 'center';
    probDiv.style.fontSize = '12px';
    probDiv.style.fontWeight = 'bold';
    probDiv.innerText = rounded + '%';
    
    el.style.position = 'relative'; // Div içinde div
    el.appendChild(probDiv);
}

// Listener
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'SYNC_BOARD') return;
    const d = event.data.payload;
    
    document.getElementById('width').value = d.width;
    document.getElementById('height').value = d.height;
    document.getElementById('totalMines').value = d.totalMines;
    
    resetBoard();
    
    d.grid.forEach(row => {
        row.forEach(c => {
            if (c.status === 'unknown') return;
            const cell = grid[c.y][c.x];
            if (c.status === 'flag') cell.state = 'flag';
            else if (c.status === 'safe') {
                cell.state = 'safe';
                cell.value = c.value;
            }
            renderCell(c.x, c.y);
        });
    });
    
    analyzeBoard();
});
