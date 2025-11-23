let grid = [];
let width = 30;
let height = 16;
let totalMines = 99;
let selectedTool = 'unknown';

// --- WEB WORKER KODU (Arka Plandaki Beyin) ---
// Bu kod ayrı bir sanal dosya gibi çalışır ve hesaplamayı yapar.
const workerCode = `
self.onmessage = function(e) {
    const { grid, width, height, totalMines } = e.data;
    const result = solve(grid, width, height, totalMines);
    self.postMessage(result);
};

function solve(serializedGrid, width, height, totalMines) {
    let unknowns = [];
    let constraints = [];
    let knownMines = 0;

    // 1. Veriyi İşlenebilir Hale Getir
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const cell = serializedGrid[y][x];
            if (cell.state === 'flag') knownMines++;
            
            if (cell.state === 'unknown') {
                cell.solverId = unknowns.length; // Hızlı erişim ID'si
                unknowns.push(cell);
            }

            if (cell.state === 'safe' && cell.value > 0) {
                let neighbors = getNeighbors(x, y, width, height);
                let flagCount = 0;
                let unknownNeighbors = [];
                
                neighbors.forEach(n => {
                    let neighborCell = serializedGrid[n.y][n.x];
                    if (neighborCell.state === 'flag') flagCount++;
                    if (neighborCell.state === 'unknown') unknownNeighbors.push(neighborCell);
                });

                let effectiveValue = cell.value - flagCount;
                if (unknownNeighbors.length > 0) {
                    constraints.push({
                        value: effectiveValue,
                        targets: unknownNeighbors.map(u => u.solverId) // Sadece ID tutuyoruz, obje değil (Hız için)
                    });
                }
            }
        }
    }

    // 2. Kümeleri (Clusters) Ayır
    // Birbirinden bağımsız bölgeleri tespit et
    let adjacency = new Map(); // Hangi bilinmeyen hangi bilinmeyenle komşu?
    
    constraints.forEach(c => {
        // Bir constraint içindeki tüm bilinmeyenler birbirine bağlıdır
        for(let i=0; i<c.targets.length; i++) {
            for(let j=i+1; j<c.targets.length; j++) {
                let u1 = c.targets[i];
                let u2 = c.targets[j];
                if(!adjacency.has(u1)) adjacency.set(u1, []);
                if(!adjacency.has(u2)) adjacency.set(u2, []);
                adjacency.get(u1).push(u2);
                adjacency.get(u2).push(u1);
            }
        }
    });

    let visited = new Set();
    let clusters = [];

    // Constraintlere dahil olan bilinmeyenler (Sınır Hattı)
    let frontierIds = new Set();
    constraints.forEach(c => c.targets.forEach(t => frontierIds.add(t)));

    frontierIds.forEach(id => {
        if(visited.has(id)) return;
        
        let cluster = [];
        let queue = [id];
        visited.add(id);
        
        while(queue.length > 0) {
            let curr = queue.pop();
            cluster.push(curr);
            
            let neighbors = adjacency.get(curr) || [];
            neighbors.forEach(n => {
                if(!visited.has(n)) {
                    visited.add(n);
                    queue.push(n);
                }
            });
        }
        clusters.push(cluster);
    });

    // 3. Her Kümeyi Çöz
    let probabilities = []; // {x, y, prob}
    let totalSolvedMines = 0;

    for (let clusterIds of clusters) {
        // Bu kümeye ait constraintleri filtrele
        let clusterSet = new Set(clusterIds);
        let relevantConstraints = constraints.filter(c => 
            c.targets.some(t => clusterSet.has(t))
        ).map(c => ({
            value: c.value,
            // Sadece bu kümedeki hedef ID'leri al, dışarıdakileri umursama
            targets: c.targets.filter(t => clusterSet.has(t)) 
        }));

        // Backtracking
        let solutions = solveCluster(clusterIds, relevantConstraints);
        
        if (solutions.length > 0) {
            let mineCounts = new Array(clusterIds.length).fill(0);
            solutions.forEach(sol => {
                sol.forEach((isMine, idx) => {
                    if(isMine) mineCounts[idx]++;
                });
            });

            // Ortalama mayın sayısı
            let avgMines = mineCounts.reduce((a,b)=>a+b,0) / solutions.length;
            totalSolvedMines += avgMines;

            clusterIds.forEach((id, idx) => {
                let realCell = unknowns[id];
                probabilities.push({
                    x: realCell.x,
                    y: realCell.y,
                    prob: (mineCounts[idx] / solutions.length) * 100
                });
            });
        }
    }

    // 4. Arkadaki Bilinmeyenler (Sınıra değmeyenler)
    let nonFrontierUnknowns = unknowns.filter(u => !frontierIds.has(u.solverId));
    let remainingMines = totalMines - knownMines - totalSolvedMines;
    
    if (nonFrontierUnknowns.length > 0) {
        if(remainingMines < 0) remainingMines = 0;
        let prob = (remainingMines / nonFrontierUnknowns.length) * 100;
        prob = Math.max(0, Math.min(100, prob));
        
        nonFrontierUnknowns.forEach(u => {
            probabilities.push({
                x: u.x,
                y: u.y,
                prob: prob
            });
        });
    }

    return probabilities;
}

function solveCluster(ids, constraints) {
    let solutions = [];
    // ID -> Local Index haritası
    let idToIndex = new Map();
    ids.forEach((id, idx) => idToIndex.set(id, idx));

    // Constraintleri yerel indekslere çevir ve optimize et
    // EN KÜÇÜK constraintleri başa al (Bu çok önemli bir optimizasyon)
    let optimizedConstraints = constraints.map(c => ({
        value: c.value,
        indices: c.targets.map(t => idToIndex.get(t))
    })).sort((a,b) => a.indices.length - b.indices.length);

    let assignment = new Array(ids.length).fill(undefined);
    
    // Değişken Sıralaması (Variable Ordering Heuristic)
    // En çok constraint içinde geçen hücreyi önce çözmeye çalış
    let occurrence = new Array(ids.length).fill(0);
    optimizedConstraints.forEach(c => c.indices.forEach(idx => occurrence[idx]++));
    
    // İndeksleri önem sırasına göre diz
    let sortedIndices = ids.map((_, i) => i).sort((a,b) => occurrence[b] - occurrence[a]);

    // HIZ SINIRI: Eğer döngü 50.000'i geçerse dur (100x100 için güvenlik kilidi)
    let iterations = 0;
    const MAX_ITER = 50000; 

    function recurse(k) {
        if (iterations++ > MAX_ITER) return; // Çok uzadıysa kes
        
        if (k === ids.length) {
            solutions.push([...assignment]);
            return;
        }

        let idx = sortedIndices[k]; // Hangi hücreyi deneyeceğiz?

        // isValid fonksiyonu o anki atamanın mantıklı olup olmadığını kontrol eder
        // Sadece ilgili constraintlere bakarak hızlı karar verir
        
        // Dene: Mayın YOK
        assignment[idx] = false;
        if (checkValid(optimizedConstraints, assignment)) {
            recurse(k + 1);
            if (solutions.length > 1000) return; // Çok fazla çözüm varsa yeter, istatistik oturmuştur
        }

        // Dene: Mayın VAR
        assignment[idx] = true;
        if (checkValid(optimizedConstraints, assignment)) {
            recurse(k + 1);
            if (solutions.length > 1000) return;
        }

        assignment[idx] = undefined;
    }

    recurse(0);
    return solutions;
}

function checkValid(constraints, assignment) {
    for (let c of constraints) {
        let mineCount = 0;
        let emptyCount = 0;
        let isComplete = true;

        for (let idx of c.indices) {
            let val = assignment[idx];
            if (val === true) mineCount++;
            else if (val === undefined) { emptyCount++; isComplete = false; }
        }

        // Çok fazla mayın koyduk -> HATA
        if (mineCount > c.value) return false;
        
        // Kalan boşlukların hepsini mayın yapsak bile yetmiyor -> HATA
        if (mineCount + emptyCount < c.value) return false;
    }
    return true;
}

function getNeighbors(x, y, w, h) {
    let n = [];
    for(let dy=-1; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
            if(dx===0 && dy===0) continue;
            let nx=x+dx, ny=y+dy;
            if(nx>=0 && nx<w && ny>=0 && ny<h) n.push({x:nx, y:ny});
        }
    }
    return n;
}
`;

// Worker Blob Oluşturma
const blob = new Blob([workerCode], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(blob);
let solverWorker = new Worker(workerUrl);

// --- UI KODLARI ---

document.addEventListener('DOMContentLoaded', () => {
    setupToolbar();
    resetBoard();
    
    // Worker Dinleyici
    solverWorker.onmessage = function(e) {
        const probabilities = e.data;
        updateStatus("Hesaplandı!");
        drawProbabilities(probabilities);
    };
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
    // Grid CSS ayarı
    boardEl.style.gridTemplateColumns = `repeat(${width}, 24px)`; // Hücreleri biraz küçülttüm (24px)
    boardEl.innerHTML = '';
    
    grid = [];
    
    // Fragment kullanarak DOM manipülasyonunu hızlandır (10.000 div için şart)
    const fragment = document.createDocumentFragment();

    for (let y = 0; y < height; y++) {
        let row = [];
        for (let x = 0; x < width; x++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            // Dataset kullanmak yavaştır, direkt array'den erişeceğiz
            // cell.dataset.x = x... satırlarını sildim performans için
            
            // Event delegation kullanmak daha iyidir ama şimdilik basit tutalım
            cell.onmousedown = (e) => handleCellClick(x, y, e);
            cell.oncontextmenu = (e) => { e.preventDefault(); toggleFlag(x, y); };

            fragment.appendChild(cell);
            row.push({ element: cell, value: null, state: 'unknown', x: x, y: y });
        }
        grid.push(row);
    }
    
    boardEl.appendChild(fragment);
    updateStatus(`Hazır: ${width}x${height}`);
}

function handleCellClick(x, y, e) {
    const cellObj = grid[y][x];
    
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
    // Tıklayınca otomatik analiz başlatsın mı? Büyük haritalarda bunu elle yapmak daha iyi olabilir.
    // analyzeBoard(); 
}

function toggleFlag(x, y) {
    const cellObj = grid[y][x];
    cellObj.state = (cellObj.state === 'flag') ? 'unknown' : 'flag';
    renderCell(x, y);
}

function renderCell(x, y) {
    const cellObj = grid[y][x];
    const el = cellObj.element;

    el.className = 'cell'; // Reset
    el.innerText = '';
    
    // Olasılık barını sil
    if(el.firstChild) el.innerHTML = '';

    if (cellObj.state === 'safe') {
        el.classList.add('open');
        if (cellObj.value > 0) {
            el.innerText = cellObj.value;
            el.className = `cell open val-${cellObj.value}`;
            el.style.color = getNumColor(cellObj.value);
        }
    } else if (cellObj.state === 'flag') {
        el.classList.add('flag');
        el.innerText = '🚩';
    } else {
        el.classList.add('closed');
    }
}

function getNumColor(n) {
    const colors = [null, 'blue', 'green', 'red', 'darkblue', 'brown', 'cyan', 'black', 'gray'];
    return colors[n] || 'black';
}

function analyzeBoard() {
    updateStatus("Analiz başlatıldı...");
    
    // Grid verisinin sadece gerekli kısmını kopyalayıp workera atıyoruz
    // DOM elemanlarını workera gönderemeyiz (Hata verir)
    const serializedGrid = grid.map(row => row.map(cell => ({
        x: cell.x,
        y: cell.y,
        state: cell.state,
        value: cell.value
    })));

    solverWorker.postMessage({
        grid: serializedGrid,
        width: width,
        height: height,
        totalMines: totalMines
    });
}

function drawProbabilities(probs) {
    // Önceki olasılıkları temizle
    // (Bunu optimize etmek için sadece değişenleri güncellemek lazım ama şimdilik idare eder)
    document.querySelectorAll('.probability').forEach(e => e.remove());

    probs.forEach(p => {
        const cell = grid[p.y][p.x];
        const el = cell.element;

        if (cell.state !== 'unknown') return;

        const probDiv = document.createElement('div');
        probDiv.className = 'probability';
        
        let rounded = Math.round(p.prob);
        probDiv.innerText = (rounded === 0 || rounded === 100) ? '' : rounded; // 0 ve 100'de sayı yazma, renk yetiyor

        if (rounded === 100) {
            el.style.backgroundColor = '#ffcccc'; // Açık Kırmızı
            el.style.border = "1px solid red";
        } else if (rounded === 0) {
            el.style.backgroundColor = '#ccffcc'; // Açık Yeşil
            el.style.border = "1px solid green";
        } else {
            // Gradient
            let alpha = 0.3 + (p.prob / 200); // 0.3 - 0.8 arası opaklık
            let hue = 120 - (p.prob * 1.2); 
            probDiv.style.backgroundColor = `hsla(${hue}, 100%, 40%, ${alpha})`;
            probDiv.innerText = rounded + '%';
        }
        
        el.appendChild(probDiv);
    });
}

function updateStatus(msg) {
    const st = document.getElementById('status');
    if(st) st.innerText = msg;
}

// --- TAMPERMONKEY MESSAGE LISTENER ---
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'SYNC_BOARD') return;
    const d = event.data.payload;
    
    // Boyut değiştiyse resetle
    if (d.width !== width || d.height !== height) {
        document.getElementById('width').value = d.width;
        document.getElementById('height').value = d.height;
        document.getElementById('totalMines').value = d.totalMines;
        resetBoard();
    }
    
    // Veriyi güncelle
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
    
    // Otomatik Analiz
    analyzeBoard();
});
