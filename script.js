let grid = [];
let width = 30;
let height = 16;
let totalMines = 99;

document.addEventListener('DOMContentLoaded', () => {
    resetBoard();
});

// --- UI KISMI ---

function resetBoard() {
    // Inputlardan değerleri al (yoksa varsayılan)
    const wInput = document.getElementById('width');
    const hInput = document.getElementById('height');
    const mInput = document.getElementById('totalMines');
    
    if(wInput) width = parseInt(wInput.value) || 30;
    if(hInput) height = parseInt(hInput.value) || 16;
    if(mInput) totalMines = parseInt(mInput.value) || 99;
    
    const boardEl = document.getElementById('board');
    boardEl.style.gridTemplateColumns = `repeat(${width}, 24px)`;
    boardEl.innerHTML = '';
    
    grid = [];

    // Tahtayı oluştur
    for (let y = 0; y < height; y++) {
        let row = [];
        for (let x = 0; x < width; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell unknown';
            
            // Veri yapısı
            const cellData = { 
                element: cell, 
                x: x, 
                y: y, 
                state: 'unknown', // unknown, safe, flag
                value: null 
            };
            
            boardEl.appendChild(cell);
            row.push(cellData);
        }
        grid.push(row);
    }
    
    document.getElementById('status').innerText = "Hazır.";
}

function renderCell(x, y) {
    const cell = grid[y][x];
    const el = cell.element;
    
    // Temizle
    el.className = 'cell';
    el.innerText = '';
    el.style.backgroundColor = ''; 
    el.style.color = '';
    
    // Olasılık yazılarını sil
    const existingProb = el.querySelector('.prob-text');
    if(existingProb) existingProb.remove();

    if (cell.state === 'safe') {
        el.classList.add('open');
        if (cell.value > 0) {
            el.innerText = cell.value;
            el.style.color = getNumberColor(cell.value);
            el.style.fontWeight = 'bold';
        }
    } else if (cell.state === 'flag') {
        el.classList.add('flag');
        el.innerText = '🚩';
    } else {
        el.classList.add('unknown');
    }
}

function getNumberColor(n) {
    return ['transparent','blue','green','red','darkblue','brown','cyan','black','gray'][n] || 'black';
}

function updateStatus(msg) {
    const el = document.getElementById('status');
    if(el) el.innerText = msg;
}


// --- ANALİZ MOTORU (BASİT AMA PARÇALI ÇÖZÜCÜ) ---

function analyzeBoard() {
    updateStatus("Hesaplanıyor...");
    
    // DOM güncellensin diye minik bir gecikme veriyoruz
    setTimeout(() => {
        try {
            runSolverLogic();
        } catch (e) {
            console.error(e);
            updateStatus("Hata oluştu.");
        }
    }, 50);
}

function runSolverLogic() {
    let unknowns = [];
    let constraints = [];
    let knownMines = 0;

    // 1. Veriyi Topla
    for(let y=0; y<height; y++) {
        for(let x=0; x<width; x++) {
            let cell = grid[y][x];
            if(cell.state === 'flag') knownMines++;
            if(cell.state === 'unknown') {
                cell.tempId = unknowns.length; // Solver için ID
                unknowns.push(cell);
            }
        }
    }

    // 2. Kısıtlamaları (Constraints) Oluştur
    for(let y=0; y<height; y++) {
        for(let x=0; x<width; x++) {
            let cell = grid[y][x];
            if(cell.state === 'safe' && cell.value > 0) {
                let neighbors = getNeighbors(x, y);
                let flagCount = 0;
                let unknownNeighbors = [];

                neighbors.forEach(n => {
                    let nc = grid[n.y][n.x];
                    if(nc.state === 'flag') flagCount++;
                    if(nc.state === 'unknown') unknownNeighbors.push(nc);
                });

                if(unknownNeighbors.length > 0) {
                    constraints.push({
                        value: cell.value - flagCount,
                        cells: unknownNeighbors // Bu kısıtlama bu hücreleri etkiliyor
                    });
                }
            }
        }
    }

    // 3. Adaları (Cluster) Bul ve Çöz
    // Burası optimizasyonun kalbi. Hepsini tek seferde değil, parça parça çözeceğiz.
    
    // Her bilinmeyen hücre için bir "Olasılık Sayacı" başlat
    let globalMineCounts = new Array(unknowns.length).fill(0);
    let globalSolutions = new Array(unknowns.length).fill(0); // Her ada için çözüm sayısı farklı olabilir
    let processedIndices = new Set(); // Hangi hücreler bir adaya dahil oldu?

    // Hücre -> Hangi Constraintlerde var?
    let cellToConstraints = new Map();
    unknowns.forEach(u => cellToConstraints.set(u.tempId, []));
    constraints.forEach(c => {
        c.cells.forEach(u => cellToConstraints.get(u.tempId).push(c));
    });

    // Gruplama ve Çözme Döngüsü
    unknowns.forEach(u => {
        if (processedIndices.has(u.tempId)) return;

        // Bu hücreden başlayarak bağlı tüm hücreleri (bir adayı) bul
        let cluster = [];
        let queue = [u];
        processedIndices.add(u.tempId);
        
        // BFS ile adayı genişlet
        let head = 0;
        while(head < queue.length){
            let curr = queue[head++];
            cluster.push(curr);
            
            let relatedCons = cellToConstraints.get(curr.tempId) || [];
            relatedCons.forEach(c => {
                c.cells.forEach(neighbor => {
                    if(!processedIndices.has(neighbor.tempId)){
                        processedIndices.add(neighbor.tempId);
                        queue.push(neighbor);
                    }
                });
            });
        }

        // --- BU ADAYI ÇÖZ ---
        // Sadece bu kümeye ait constraintleri al
        let clusterSet = new Set(cluster.map(c=>c.tempId));
        let clusterConstraints = constraints.filter(c => 
            c.cells.some(cell => clusterSet.has(cell.tempId))
        ).map(c => ({
            val: c.value,
            ids: c.cells.filter(cell => clusterSet.has(cell.tempId)).map(cell => cell.tempId)
        }));

        // Backtracking Çözücü
        let solutions = solveCluster(cluster.map(c=>c.tempId), clusterConstraints);
        
        // Sonuçları Global Listeye Ekle
        if(solutions.length > 0) {
            solutions.forEach(sol => {
                sol.forEach((isMine, idx) => {
                    // cluster[idx] hücresi
                    let originalId = cluster[idx].tempId;
                    globalSolutions[originalId]++; 
                    if(isMine) globalMineCounts[originalId]++;
                });
            });
        }
    });

    // 4. Sonuçları Ekrana Yaz
    let solvedMines = 0;
    
    unknowns.forEach(u => {
        let totalSols = globalSolutions[u.tempId];
        if (totalSols > 0) {
            let prob = (globalMineCounts[u.tempId] / totalSols);
            solvedMines += prob; // Ortalama mayın katkısı
            drawProb(u, prob * 100);
        }
    });

    // 5. Arkada Kalanlar (Sayılarla hiç alakası olmayanlar)
    let disconnected = unknowns.filter(u => globalSolutions[u.tempId] === 0);
    if (disconnected.length > 0) {
        let remainingMines = totalMines - knownMines - solvedMines;
        if(remainingMines < 0) remainingMines = 0;
        let prob = (remainingMines / disconnected.length) * 100;
        prob = Math.max(0, Math.min(100, prob));
        
        disconnected.forEach(u => drawProb(u, prob));
    }

    updateStatus("Tamamlandı.");
}

// Rekürsif Çözücü (Cluster Bazlı)
function solveCluster(ids, constraints) {
    let results = [];
    let assignment = {}; // id -> true/false
    
    // Değişkenleri constraint sayısına göre sırala (Heuristic)
    ids.sort((a,b) => {
        let ca = constraints.filter(c=>c.ids.includes(a)).length;
        let cb = constraints.filter(c=>c.ids.includes(b)).length;
        return cb - ca;
    });

    // HIZ SINIRI: Aşırı büyük boşluklarda donmaması için
    let iterations = 0;
    const MAX_ITER = 20000; 

    function recurse(index) {
        if(iterations++ > MAX_ITER) return; 

        if (index === ids.length) {
            // Çözüm bulundu, kaydet (Array olarak, ids sırasına uygun)
            let sol = ids.map(id => assignment[id]);
            results.push(sol);
            return;
        }

        let currentId = ids[index];

        // Dene: Mayın YOK
        assignment[currentId] = false;
        if (isValid(assignment, constraints)) {
            recurse(index + 1);
        }

        // Dene: Mayın VAR
        assignment[currentId] = true;
        if (isValid(assignment, constraints)) {
            recurse(index + 1);
        }
        
        delete assignment[currentId];
    }

    recurse(0);
    return results;
}

function isValid(assignment, constraints) {
    for (let c of constraints) {
        let mineCount = 0;
        let unknownCount = 0;
        
        for (let id of c.ids) {
            if (assignment[id] === true) mineCount++;
            else if (assignment[id] === undefined) unknownCount++;
        }

        // Kural İhlali Kontrolleri
        if (mineCount > c.val) return false; // Fazla mayın
        if (mineCount + unknownCount < c.val) return false; // Yetersiz alan
    }
    return true;
}

function drawProb(cell, percent) {
    const el = cell.element;
    
    // Varsa eskisini sil
    const old = el.querySelector('.prob-text');
    if(old) old.remove();

    const p = Math.round(percent);
    
    const div = document.createElement('div');
    div.className = 'prob-text';
    div.innerText = (p===0 || p===100) ? '' : p;
    
    div.style.position = 'absolute';
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.display = 'flex';
    div.style.justifyContent = 'center';
    div.style.alignItems = 'center';
    div.style.fontSize = '11px';
    div.style.pointerEvents = 'none';
    div.style.color = 'black';
    div.style.textShadow = '0 0 2px white';
    
    if(p === 100) {
        el.style.backgroundColor = 'red';
    } else if (p === 0) {
        el.style.backgroundColor = 'cyan';
    } else {
        // Yeşil (%0) -> Sarı (%100)
        let hue = 120 - (p * 0.6); // 120 yeşil, 60 sarı
        el.style.backgroundColor = `hsl(${hue}, 100%, 75%)`;
    }
    
    el.appendChild(div);
}

function getNeighbors(x, y) {
    let n = [];
    for(let dy=-1; dy<=1; dy++){
        for(let dx=-1; dx<=1; dx++){
            if(dx===0 && dy===0) continue;
            let nx=x+dx, ny=y+dy;
            if(nx>=0 && nx<width && ny>=0 && ny<height) n.push({x:nx, y:ny});
        }
    }
    return n;
}

// Tampermonkey'den veri alma
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'SYNC_BOARD') return;
    const d = event.data.payload;

    // Boyut değişti mi?
    if(d.width !== width || d.height !== height) {
        document.getElementById('width').value = d.width;
        document.getElementById('height').value = d.height;
        document.getElementById('totalMines').value = d.totalMines;
        resetBoard();
    }
    
    // Veriyi işle
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
