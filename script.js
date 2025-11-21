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
    width = parseInt(document.getElementById('width').value);
    height = parseInt(document.getElementById('height').value);
    totalMines = parseInt(document.getElementById('totalMines').value);
    
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
            cell.dataset.state = 'unknown'; // unknown, flag, safe (numbers)
            
            cell.addEventListener('mousedown', (e) => handleCellClick(x, y, e));
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                // Sağ tık kısayolu: Bayrak ve Bilinmeyen arasında geçiş
                toggleFlag(x, y);
            });

            boardEl.appendChild(cell);
            row.push({ element: cell, value: null, state: 'unknown' }); // value: 0-8
        }
        grid.push(row);
    }
    updateStatus("Tahta hazır. Durumu çizip 'Analiz Et'e basın.");
}

function handleCellClick(x, y, e) {
    const cellObj = grid[y][x];
    const el = cellObj.element;

    // Mevcut olasılıkları temizle
    clearProbabilities();

    if (selectedTool === 'flag') {
        cellObj.state = 'flag';
        cellObj.value = null;
    } else if (selectedTool === 'unknown') {
        cellObj.state = 'unknown';
        cellObj.value = null;
    } else {
        // Sayı yerleştirme (0-8)
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

    el.className = 'cell'; // Reset class
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

// --- ANALİZ MOTORU (SOLVER) ---

function analyzeBoard() {
    clearProbabilities();
    updateStatus("Hesaplanıyor...");

    // 1. Temel Hazırlık: Bilinmeyenleri ve Kısıtları (Constraints) Bul
    let unknowns = [];
    let constraints = [];
    let knownMines = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const cell = grid[y][x];
            
            // Bayrakları say
            if (cell.state === 'flag') knownMines++;
            
            // Bilinmeyenleri listele
            if (cell.state === 'unknown') {
                unknowns.push({x, y, index: unknowns.length});
            }

            // Sayı kısıtlarını oluştur
            if (cell.state === 'safe' && cell.value > 0) {
                let neighbors = getNeighbors(x, y);
                let flagsAround = neighbors.filter(n => grid[n.y][n.x].state === 'flag').length;
                let unknownNeighbors = neighbors.filter(n => grid[n.y][n.x].state === 'unknown');
                
                // Sayının istediği kalan mayın sayısı (Sayı - Etrafındaki Bayraklar)
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

    // 2. Sınır (Frontier) Ayrımı
    // Sadece sayılara değen bilinmeyenleri (Frontier) hesaplayacağız.
    let frontierSet = new Set();
    constraints.forEach(c => {
        c.targets.forEach(t => frontierSet.add(`${t.x},${t.y}`));
    });

    let frontierCells = unknowns.filter(u => frontierSet.has(`${u.x},${u.y}`));
    let otherUnknowns = unknowns.filter(u => !frontierSet.has(`${u.x},${u.y}`));

    // Çözüm değişkenleri
    let validSolutions = 0;
    let mineCounts = new Array(frontierCells.length).fill(0);

    // 3. Recursive Backtracking (Çözücü Fonksiyon)
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
        if (isValidSoFar(cell)) {
            solve(index + 1);
        }

        // Dene: Mayın Yok
        cell.isMine = false;
        if (isValidSoFar(cell)) {
            solve(index + 1);
        }
        
        delete cell.isMine; // Temizlik
    }

    // Geçerlilik Kontrolü
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
            if (placedMines > c.value) return false; // Çok fazla mayın
            if (c.value > placedMines + undefinedCells) return false; // Yetersiz boşluk
        }
        return true;
    }

    // 4. Asenkron Çalıştırma (Arayüzü dondurmamak için)
    setTimeout(() => {
        solve(0);

        // --- SONUÇLARI TOPLAMA VE GÖNDERME KISMI ---
        let resultsToSend = []; 

        if (validSolutions === 0) {
            updateStatus("Hata: İmkansız konfigürasyon veya çelişki var!");
            return;
        }

        // A) Frontier Hücrelerin Sonuçları
        frontierCells.forEach((cell, i) => {
            let probability = (mineCounts[i] / validSolutions) * 100;
            
            // 1. Kendi sitemize çiz
            showProbability(cell.x, cell.y, probability);
            
            // 2. Gönderilecek pakete ekle
            resultsToSend.push({ x: cell.x, y: cell.y, percent: probability });
        });

        // B) Diğer (Arkada Kalan) Hücrelerin Sonuçları
        let avgFrontierMines = mineCounts.reduce((a,b)=>a+b, 0) / validSolutions;
        let remainingMines = totalMines - knownMines - avgFrontierMines;
        
        if (otherUnknowns.length > 0) {
            let otherProb = (remainingMines / otherUnknowns.length) * 100;
            otherProb = Math.max(0, Math.min(100, otherProb)); // 0-100 arasına sabitle
            
            otherUnknowns.forEach(cell => {
                // 1. Kendi sitemize çiz
                showProbability(cell.x, cell.y, otherProb);
                
                // 2. Gönderilecek pakete ekle
                resultsToSend.push({ x: cell.x, y: cell.y, percent: otherProb });
            });
        }

        updateStatus("Analiz bitti. Sonuçlar oyuna gönderildi.");

        // C) Sonuçları Oyun Sitesine (window.opener) Gönder
        if (window.opener) {
            window.opener.postMessage({
                type: 'ANALYSIS_RESULT',
                data: resultsToSend
            }, '*');
        }

    }, 10);
}
    // Basit hataları yakala
    for(let c of constraints) {
        if (c.value < 0) {
            alert(`Hata: (${c.x},${c.y}) noktasında çok fazla bayrak var!`);
            return;
        }
        if (c.value > c.targets.length) {
            alert(`Hata: (${c.x},${c.y}) noktasında yeterli boş alan yok!`);
            return;
        }
    }

    // 2. Sınır Optimizasyonu
    // Tüm bilinmeyenleri denemek çok uzun sürer. Sadece sayılara değenleri (Frontier) hesaplayacağız.
    // Sayılara değmeyen "arka plandaki" bilinmeyenler, kalan mayınları paylaşır.
    
    let frontierSet = new Set();
    constraints.forEach(c => {
        c.targets.forEach(t => frontierSet.add(`${t.x},${t.y}`));
    });

    let frontierCells = unknowns.filter(u => frontierSet.has(`${u.x},${u.y}`));
    let otherUnknowns = unknowns.filter(u => !frontierSet.has(`${u.x},${u.y}`));

    // Çözümler
    let validSolutions = 0;
    let mineCounts = new Array(frontierCells.length).fill(0);

    // Recursive Backtracking
    // Frontier hücrelere mayın koyup koymama durumlarını dene
    
    function solve(index) {
        if (index === frontierCells.length) {
            // Tüm frontier hücrelere karar verildi. Bu geçerli bir çözüm mü?
            // Tüm constraintleri kontrol et
            // Not: Backtracking sırasında "erken budama" (pruning) yapmak daha hızlıdır ama
            // kod karmaşıklığını arttırır. Bu haliyle küçük/orta tahtalarda hızlı çalışır.
            validSolutions++;
            for(let i=0; i<frontierCells.length; i++) {
                if (frontierCells[i].isMine) mineCounts[i]++;
            }
            return;
        }

        let cell = frontierCells[index];

        // Dene: Mayın Var
        cell.isMine = true;
        if (isValidSoFar(cell)) {
            solve(index + 1);
        }

        // Dene: Mayın Yok
        cell.isMine = false;
        if (isValidSoFar(cell)) {
            solve(index + 1);
        }
        
        // Temizlik
        delete cell.isMine;
    }

    // Kısıtlamaları kontrol et. Sadece şu ana kadar atanmış hücrelerle ilgili kısıtları kontrol eder.
    function isValidSoFar(changedCell) {
        // Değişen hücreyi etkileyen constraintlere bak
        // Performans için: Normalde constraint listesini hücreye göre maplemek gerekir.
        // Basitlik için tüm constraintleri geziyoruz (Grid küçükse sorun olmaz).
        
        for (let c of constraints) {
            let placedMines = 0;
            let undefinedCells = 0;
            let isRelevant = false;

            for (let t of c.targets) {
                // target referansını frontierCells içindeki gerçek objeyle eşleştir
                // (Referanslar aynı olmalı, değilse koordinatla bul)
                let realCell = frontierCells.find(f => f.x === t.x && f.y === t.y);
                
                if (realCell) {
                    if (realCell === changedCell) isRelevant = true;
                    if (realCell.isMine === true) placedMines++;
                    else if (realCell.isMine === undefined) undefinedCells++;
                }
            }

            if (!isRelevant) continue;

            // Eğer koyduğumuz mayınlar sayıyı geçtiyse -> GEÇERSİZ
            if (placedMines > c.value) return false;

            // Eğer kalan boşluklar sayıyı tamamlamaya yetmiyorsa -> GEÇERSİZ
            // (Gerekli Mayın) > (Şu anki + Kalan Bilinmeyenler)
            if (c.value > placedMines + undefinedCells) return false;
        }
        return true;
    }

    // Çözücüyü çalıştır
    // Web Worker olmadan büyük tahtalarda donabilir, bu yüzden küçük tutun.
    setTimeout(() => {
        solve(0);

        if (validSolutions === 0) {
            updateStatus("Bu konfigürasyon imkansız!");
            return;
        }

        // Frontier Olasılıklarını Yazdır
        frontierCells.forEach((cell, i) => {
            let probability = (mineCounts[i] / validSolutions) * 100;
            showProbability(cell.x, cell.y, probability);
        });

        // Frontier olmayanlar (Kalanlar)
        // Toplam olası mayın sayısı hesabı karmaşık olabilir (Global Constraint).
        // Mr Gris sitesi, toplam mayın sayısını da bir constraint olarak kullanır.
        // Burada basitlik adına: (Toplam Mayın - Bilinen Bayrak - Ortalama Frontier Mayını) / Kalan Hücre
        
        let avgFrontierMines = mineCounts.reduce((a,b)=>a+b, 0) / validSolutions;
        let remainingMines = totalMines - knownMines - avgFrontierMines;
        
        if (otherUnknowns.length > 0) {
            let otherProb = (remainingMines / otherUnknowns.length) * 100;
            otherProb = Math.max(0, Math.min(100, otherProb)); // Sınırla
            
            otherUnknowns.forEach(cell => {
                showProbability(cell.x, cell.y, otherProb);
            });
        }

        updateStatus("Analiz tamamlandı.");
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
    
    // Yuvarlanmış yüzdeyi alalım (99.9 gibi sayılar karışıklık yaratmasın)
    let roundedPercent = Math.round(percent);

    // --- RENK AYARLARI ---
    const colorZero = '#000080';      // %0 için Kırmızı
    const colorHundred = '#FF0000';   // %100 için Lacivert
    const colorFill = '#4CAF50';      // Dolum Rengi (Yeşil)
    const colorEmpty = '#FFEB3B';     // Boşluk Rengi (Sarı)
    
    if (roundedPercent === 100) {
        // KESİN MAYIN -> LACİVERT
        probDiv.style.backgroundColor = colorHundred;
        probDiv.style.color = '#ffffff'; // Lacivert üstüne beyaz yazı
    } else if (roundedPercent === 0) {
        // KESİN GÜVENLİ -> KIRMIZI
        probDiv.style.backgroundColor = colorZero;
        probDiv.style.color = '#ffffff'; // Kırmızı üstüne beyaz yazı
    } else {
        // ARADAKİLER -> YEŞİL / SARI GRADIENT
        // Alttan yukarı doğru %X kadar Yeşil, kalanı Sarı
        probDiv.style.background = `linear-gradient(to top, ${colorFill} ${percent}%, ${colorEmpty} ${percent}%)`;
        probDiv.style.color = '#000000'; // Sarı/Yeşil üstüne siyah yazı daha iyi okunur
    }
    
    // Ortak Stil Ayarları
    probDiv.style.fontWeight = 'bold';
    // Yazı gölgesi (Okunabilirlik için)
    if (roundedPercent > 0 && roundedPercent < 100) {
        probDiv.style.textShadow = '0px 0px 2px #fff'; // Ara renklerde beyaz gölge
    } else {
        probDiv.style.textShadow = 'none'; // Düz renklerde gölgeye gerek yok
    }
    
    probDiv.style.display = 'flex';
    probDiv.style.alignItems = 'center';
    probDiv.style.justifyContent = 'center';
    probDiv.style.fontSize = '13px';

    // Yüzdeyi yaz
    probDiv.innerText = roundedPercent + '%';
    
    el.appendChild(probDiv);
}

function updateStatus(msg) {
    document.getElementById('status').innerText = msg;
}


// Dışarıdan gelen mesajları dinle
window.addEventListener('message', (event) => {
    // Güvenlik kontrolü: Sadece beklediğimiz veriyi işleyelim
    if (!event.data || event.data.type !== 'SYNC_BOARD') return;

    const gameData = event.data.payload;
    
    // Gelen veriye göre inputları güncelle
    document.getElementById('width').value = gameData.width;
    document.getElementById('height').value = gameData.height;
    document.getElementById('totalMines').value = gameData.totalMines;

    // Tahtayı yeniden oluştur
    resetBoard();

    // Hücreleri doldur
    gameData.grid.forEach(row => {
        row.forEach(cellData => {
            if (cellData.status === 'unknown') return; // Zaten varsayılan

            const cellObj = grid[cellData.y][cellData.x];
            
            if (cellData.status === 'flag') {
                cellObj.state = 'flag';
            } else if (cellData.status === 'safe') {
                cellObj.state = 'safe';
                cellObj.value = cellData.value;
            }
            
            // Görünümü güncelle
            renderCell(cellData.x, cellData.y);
        });
    });

    // Otomatik analiz başlat
    analyzeBoard();
});

