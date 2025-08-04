const toggleBtn = document.getElementById('toggleBtn');
const statusText = document.getElementById('statusText');
const botStatusDetail = document.getElementById('botStatusDetail');
const logoutBtn = document.getElementById('logoutBtn');
const extractKeysBtn = document.getElementById('extractKeysBtn');
const previewBtn = document.getElementById('previewBtn');
const saveTemplateBtn = document.getElementById('saveTemplateBtn');
const templateMsg = document.getElementById('templateMsg');
const targetNumber = document.getElementById('targetNumber');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const copyBtn = document.getElementById('copyBtn');
const pasteBtn = document.getElementById('pasteBtn');
const previewResult = document.getElementById('previewResult');
const keywordsContainer = document.getElementById('keywordsContainer');

let botIsRunning = false;
let detectedKeywords = new Set();
let templatesData = {};

// Fungsi untuk memperbarui UI kata kunci (ditambahkan karena tidak ada di kode asli)
function updateKeywordsUI() {
  if (!keywordsContainer) return;
  
  keywordsContainer.innerHTML = '';
  if (detectedKeywords.size === 0) {
    keywordsContainer.innerHTML = '<p>Belum ada kata kunci terdeteksi</p>';
    return;
  }
  
  detectedKeywords.forEach(keyword => {
    const keywordEl = document.createElement('span');
    keywordEl.className = 'keyword-tag';
    keywordEl.textContent = `{${keyword}}`;
    keywordsContainer.appendChild(keywordEl);
  });
}

// Tab switching functionality - PERBAIKAN: menggunakan .sidebar-link yang sesuai dengan HTML
document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', () => {
    const tabId = link.getAttribute('data-tab');
    
    // Update active tab button
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    
    // Show active tab panel
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
      if (panel.id === tabId) {
        panel.classList.add('active');
      }
    });
    
    // Load templates when switching to template list tab
    if (tabId === 'template-list') {
      loadTemplates();
    }

    if (tabId === 'message-history') {
      loadMessageHistory();
    }
  });
});

// Fungsi untuk mengirim pesan
async function sendMessage() {
  const number = targetNumber.value.trim();
  const message = previewResult.textContent;
  const templateName = document.getElementById('templateName').value.trim();
  
  if (!number) {
    templateMsg.textContent = 'Mohon masukkan nomor tujuan';
    templateMsg.className = 'message error';
    setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
    return;
  }
  
  if (!message || message === 'Hasil akan ditampilkan di sini...') {
    templateMsg.textContent = 'Tidak ada pesan untuk dikirim. Silakan buat preview terlebih dahulu';
    templateMsg.className = 'message error';
    setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
    return;
  }
  
  try {
    sendMessageBtn.disabled = true;
    sendMessageBtn.textContent = 'Mengirim...';
    
    const res = await fetch('/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetNumber: number, message })
    });
    
    const data = await res.json();
    
    if (data.success) {
      templateMsg.textContent = 'Pesan berhasil dikirim ke antrean! ✅';
      templateMsg.className = 'message success';

      // Simpan ke history
      try {
        const historyRes = await fetch('/message-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateName: templateName || 'Template Tanpa Nama',
            targetNumber: number,
            messageContent: message
          })
        });
        
        const historyData = await historyRes.json();
        console.log('Hasil penyimpanan history:', historyData);
        
        if (!historyData.success) {
          console.error('Gagal menyimpan history:', historyData.message);
        }
      } catch (historyErr) {
        console.error('Error saving message history:', historyErr);
      }
    } else {
      templateMsg.textContent = 'Gagal mengirim pesan: ' + (data.message || 'Terjadi kesalahan');
      templateMsg.className = 'message error';
    }
  } catch (err) {
    console.error('Error sending message:', err);
    templateMsg.textContent = 'Terjadi kesalahan saat mengirim pesan';
    templateMsg.className = 'message error';
  } finally {
    sendMessageBtn.disabled = false;
    sendMessageBtn.textContent = 'Kirim Pesan';
    setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 5000);
  }
}

// Fungsi untuk mengambil history pesan
async function loadMessageHistory() {
  try {
  const historyContainer = document.getElementById('historyContainer');
    if (!historyContainer) {
      console.error('Element historyContainer tidak ditemukan');
      return;
    }
  
  historyContainer.innerHTML = '<p class="loading-text"><i class="fas fa-spinner fa-spin"></i> Memuat history pesan...</p>';
  
    const response = await fetch('/message-history');
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Respons server bukan JSON yang valid');
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Gagal memuat history pesan');
    }
    
    if (!data.messages || data.messages.length === 0) {
      historyContainer.innerHTML = '<p class="empty-state">Belum ada history pesan</p>';
    return;
  }
  
    // Urutkan pesan berdasarkan waktu terbaru
    const sortedMessages = data.messages.sort((a, b) => 
      new Date(b.sentAt || b.timestamp) - new Date(a.sentAt || a.timestamp)
    );
    
    // Buat HTML untuk setiap pesan
    const messagesHtml = sortedMessages.map(message => `
      <div class="history-item">
        <div class="history-header">
          <span class="history-date">${formatDate(message.sentAt || message.timestamp)}</span>
          <span class="history-status ${message.status}">${message.status}</span>
        </div>
        <div class="history-content">
          <div class="history-number">
            <i class="fab fa-whatsapp"></i>
            ${message.targetNumber}
          </div>
          <div class="history-message">
            ${message.message}
          </div>
          ${message.template ? `
            <div class="history-template">
              <i class="fas fa-file-alt"></i>
              Template: ${message.template}
            </div>
          ` : ''}
          ${message.error ? `
            <div class="history-error">
              <i class="fas fa-exclamation-circle"></i>
              Error: ${message.error}
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
    
    // Tambahkan tombol aksi
    const actionsHtml = `
      <div class="history-actions">
        <button id="refreshHistoryBtn" class="action-btn">
          <i class="fas fa-sync-alt"></i> Refresh
        </button>
        <button id="clearHistoryBtn" class="action-btn btn-danger">
          <i class="fas fa-trash"></i> Hapus History
        </button>
      </div>
    `;
    
    historyContainer.innerHTML = actionsHtml + messagesHtml;
    
    // Tambahkan event listener untuk tombol refresh
    document.getElementById('refreshHistoryBtn').addEventListener('click', loadMessageHistory);
    
    // Tambahkan event listener untuk tombol hapus
    document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
      if (confirm('Yakin ingin menghapus semua history pesan?')) {
        try {
          const response = await fetch('/message-history', {
            method: 'DELETE'
          });
          
          const data = await response.json();
          
          if (data.success) {
            loadMessageHistory();
            templateMsg.textContent = 'History pesan berhasil dihapus';
            templateMsg.className = 'message success';
            setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
          } else {
            throw new Error(data.message || 'Gagal menghapus history');
          }
        } catch (err) {
          console.error('Error clearing history:', err);
          templateMsg.textContent = 'Gagal menghapus history: ' + err.message;
          templateMsg.className = 'message error';
          setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
        }
      }
    });
    
  } catch (error) {
    console.error('Error loading message history:', error);
    const historyContainer = document.getElementById('historyContainer');
    if (historyContainer) {
      historyContainer.innerHTML = `
        <p class="error-message">
          <i class="fas fa-exclamation-circle"></i>
          ${error.message}
        </p>
      `;
    }
  }
}

// Fungsi untuk memformat tanggal
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Event listener untuk filter history
document.getElementById('filterHistoryBtn')?.addEventListener('click', async () => {
  const dateFilter = document.getElementById('historyDateFilter').value;
  if (!dateFilter) {
    await loadMessageHistory();
    return;
  }
  
  try {
    const historyContainer = document.getElementById('historyContainer');
    historyContainer.innerHTML = '<p class="loading-text"><i class="fas fa-spinner fa-spin"></i> Memuat history pesan...</p>';
    
    const response = await fetch(`/message-history?startDate=${dateFilter}&endDate=${dateFilter}`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || 'Gagal memuat history pesan');
    }
    
    if (!data.messages || data.messages.length === 0) {
      historyContainer.innerHTML = '<p class="empty-state">Tidak ada history pesan untuk tanggal ini</p>';
      return;
    }
    
    // Urutkan pesan berdasarkan waktu terbaru
    const sortedMessages = data.messages.sort((a, b) => 
      new Date(b.sentAt) - new Date(a.sentAt)
    );
    
    // Buat HTML untuk setiap pesan
    const messagesHtml = sortedMessages.map(message => `
      <div class="history-item">
        <div class="history-header">
          <span class="history-date">${formatDate(message.sentAt)}</span>
          <span class="history-status ${message.status}">${message.status}</span>
        </div>
        <div class="history-content">
          <div class="history-number">
            <i class="fab fa-whatsapp"></i>
            ${message.targetNumber}
        </div>
          <div class="history-message">
            ${message.message}
          </div>
          ${message.template ? `
            <div class="history-template">
              <i class="fas fa-file-alt"></i>
              Template: ${message.template}
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
    
    historyContainer.innerHTML = messagesHtml;
    
  } catch (error) {
    console.error('Error filtering message history:', error);
    const historyContainer = document.getElementById('historyContainer');
    historyContainer.innerHTML = `
      <p class="error-message">
        <i class="fas fa-exclamation-circle"></i>
        ${error.message}
      </p>
    `;
  }
});

// Event listener untuk tab history
document.querySelector('.sidebar-link[data-tab="message-history"]')?.addEventListener('click', () => {
  loadMessageHistory();
});

// Fungsi untuk menampilkan modal pesan lengkap
function showFullMessageModal(message) {
  // Cek apakah modal sudah ada
  let modal = document.getElementById('fullMessageModal');
  
  if (!modal) {
    // Buat modal jika belum ada
    modal = document.createElement('div');
    modal.id = 'fullMessageModal';
    modal.className = 'modal';
    
    modal.innerHTML = `
      <div class="modal-content">
        <span class="close-modal">&times;</span>
        <h3>Pesan Lengkap</h3>
        <div class="full-message-content"></div>
        <button class="copy-message-btn">
          <i class="fas fa-copy"></i> Salin Pesan
        </button>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listener untuk tombol tutup
    modal.querySelector('.close-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    // Event listener untuk tombol salin
    modal.querySelector('.copy-message-btn').addEventListener('click', () => {
      const textToCopy = modal.querySelector('.full-message-content').textContent;
      navigator.clipboard.writeText(textToCopy).then(() => {
        alert('Pesan berhasil disalin ke clipboard');
      }).catch(err => {
        console.error('Gagal menyalin teks:', err);
      });
    });
  }
  
  // Tampilkan pesan
  modal.querySelector('.full-message-content').textContent = message;
  modal.style.display = 'block';
}

// Tambahkan event listener untuk menyalin hasil ke clipboard
function copyToClipboard() {
  const text = previewResult.textContent;
  
  if (!text || text === 'Hasil akan ditampilkan di sini...') {
    templateMsg.textContent = 'Tidak ada teks untuk disalin';
    templateMsg.className = 'message error';
    setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
    return;
  }
  
  navigator.clipboard.writeText(text).then(() => {
    templateMsg.textContent = 'Hasil berhasil disalin ke clipboard';
    templateMsg.className = 'message success';
    setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
  }).catch(err => {
    console.error('Error copying text: ', err);
    templateMsg.textContent = 'Gagal menyalin teks';
    templateMsg.className = 'message error';
    setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
  });
}

// Fungsi untuk menempelkan teks dari clipboard
function pasteFromClipboard() {
  navigator.clipboard.readText().then(text => {
    targetNumber.value = text.trim();
  }).catch(err => {
    console.error('Error pasting text: ', err);
    templateMsg.textContent = 'Gagal menempelkan teks dari clipboard';
    templateMsg.className = 'message error';
    setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
  });
}

// Bot status check
async function checkStatus() {
  try {
    const res = await fetch('/status');
    const data = await res.json();
    botIsRunning = data.status === 'online';
    updateUI();
  } catch (err) {
    console.error('Error checking status:', err);
    statusText.textContent = 'Gagal mengambil status bot';
    botStatusDetail.textContent = 'Tidak diketahui';
    toggleBtn.textContent = 'Coba Lagi';
    toggleBtn.disabled = true;
  }
}

// Update UI based on bot status
function updateUI() {
  if (botIsRunning) {
    statusText.textContent = 'Status: Bot Aktif ✅';
    botStatusDetail.textContent = 'Online dan berjalan normal';
    toggleBtn.textContent = '🛑 Matikan Bot';
    toggleBtn.classList.add('btn-stop');
    toggleBtn.classList.remove('btn-start');
  } else {
    statusText.textContent = 'Status: Bot Tidak Aktif ❌';
    botStatusDetail.textContent = 'Offline, silakan nyalakan bot';
    toggleBtn.textContent = '🚀 Nyalakan Bot';
    toggleBtn.classList.add('btn-start');
    toggleBtn.classList.remove('btn-stop');
  }
}

// Toggle bot status
async function toggleBot() {
  const endpoint = botIsRunning ? '/stop-bot' : '/start-bot';
  try {
    toggleBtn.disabled = true;
    toggleBtn.textContent = botIsRunning ? 'Mematikan...' : 'Menyalakan...';
    
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      botIsRunning = !botIsRunning;
      updateUI();
    } else {
      statusText.textContent = 'Gagal memperbarui status bot';
    }
  } catch (err) {
    statusText.textContent = 'Terjadi kesalahan saat memproses';
  } finally {
    toggleBtn.disabled = false;
  }
}

// Logout functionality
async function logout() {
  await fetch('/logout');
  window.location.href = '/login.html';
}

// Extract keywords from source text
function extractKeywords() {
  const sourceText = document.getElementById('sourceText').value;
  detectedKeywords.clear();
  
  // Common patterns to look for - improved regexes
  const patterns = [
    { regex: /e-?mail\s*:?\s*([^\n]+)/i, key: 'email' },
    { regex: /(?:password|pwd|pass)\s*:?\s*([^\n]+)/i, key: 'password' }, // Improved password detection
    { regex: /profil\s*:?\s*([^\n]+)/i, key: 'profile' },
    { regex: /pin\s*:?\s*([^\n]+)/i, key: 'pin' },
    { regex: /pembelian\s*:?\s*([^\n]+)/i, key: 'tanggal' },
    { regex: /expired\s*:?\s*([^\n]+)/i, key: 'expired' },
    { regex: /kadaluarsa\s*:?\s*([^\n]+)/i, key: 'expired' }
  ];
  
  // Extract keywords from patterns
  patterns.forEach(pattern => {
    const match = sourceText.match(pattern.regex);
    if (match) {
      detectedKeywords.add(pattern.key);
    }
  });
  
  // Special check for PASSWORD which might be written in different formats
  if (sourceText.includes('PASSWORD') || sourceText.includes('Password') || 
      sourceText.includes('pwd') || sourceText.includes('PASS')) {
    detectedKeywords.add('password');
  }
  
  // Special check for PROFILE and PIN
  const profilePinCheck = sourceText.match(/PROFIL[E]?\s*:?\s*([^\n]+)/i) || 
                         sourceText.match(/profile & pin|profil & pin/i);
  if (profilePinCheck) {
    detectedKeywords.add('profile');
    detectedKeywords.add('pin');
  }
  
  // Add common keywords that might be needed but not detected
  if (document.getElementById('templateName').value.toLowerCase().includes('netflix')) {
    detectedKeywords.add('email');
    detectedKeywords.add('password');
    detectedKeywords.add('profile');
    detectedKeywords.add('pin');
  }
  
  // Add duration related keywords
  detectedKeywords.add('tanggal');
  detectedKeywords.add('expired');
  
  // Update UI with detected keywords
  updateKeywordsUI();
  
  // Show success message
  templateMsg.textContent = 'Kata kunci berhasil diekstrak';
  templateMsg.className = 'message success';
  setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
}

// Generate preview from template
function generatePreview() {
  const sourceText = document.getElementById('sourceText').value;
  const templateText = document.getElementById('templateBody').value;
  const previewResult = document.getElementById('previewResult');
  const durationType = document.getElementById('durationType').value;
  const durationValue = parseInt(document.getElementById('durationValue').value) || 1;

  // Improved email detection
  let email = sourceText.match(/(?:EMAIL|E-?Mail|Mail)[\s:]+([^\s@]+@[^\s@]+\.[^\s@]+)/i)?.[1]?.trim() || 
              sourceText.match(/([^\s@]+@[^\s@]+\.[^\s@]+)/)?.[1]?.trim() || 'Tidak ditemukan';
  
  // Improved password detection
  let password = sourceText.match(/(?:PASSWORD|Pass(?:word)?|PWD)[\s:]+([^\n]+)/i)?.[1]?.trim() || 
                 sourceText.match(/(?:\ud83d\udd11\s*Password|Password|Pass|Pwd)[\s:]+([^\n]+)/i)?.[1]?.trim() || 'Tidak ditemukan';
  
  // Improved profile detection - separate from PIN
  let profile = 'Tidak ditemukan';
  let pin = 'Tidak ditemukan';
  
  // Try different patterns for profile and PIN
  let profileMatch = sourceText.match(/PROFIL[E]?\s*:\s*([^\n]+)/i);
  if (profileMatch) {
    profile = profileMatch[1].trim();
  }
  
  let pinMatch = sourceText.match(/PIN\s*:\s*([^\n]+)/i);
  if (pinMatch) {
    pin = pinMatch[1].trim();
  }
  
  // Special format check for "PROFILE & PIN" section
  let profilePinSection = sourceText.match(/(?:PROFILE & PIN|Profil & Pin)[\s\S]*?(?:\n|$)(.*?):\s*(\d+)/i);
  if (profilePinSection) {
    profile = profilePinSection[1].trim();
    pin = profilePinSection[2].trim();
  }

  // Hitung tanggal beli dan expired
  let now = new Date();
  let expired = new Date(now);
  switch (durationType) {
    case 'tahun': expired.setFullYear(now.getFullYear() + durationValue); break;
    case 'bulan': expired.setMonth(now.getMonth() + durationValue); break;
    default: expired.setDate(now.getDate() + durationValue); break;
  }

  let bulanIndo = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const formatTanggal = (tgl) => `${tgl.getDate().toString().padStart(2, '0')} ${bulanIndo[tgl.getMonth()]} ${tgl.getFullYear()}`;

  // Ganti semua placeholder di template
  let result = templateText
    .replaceAll('{email}', email)
    .replaceAll('{password}', password)
    .replaceAll('{profile}', profile)
    .replaceAll('{pin}', pin)
    .replaceAll('{tanggal}', formatTanggal(now))
    .replaceAll('{expired}', formatTanggal(expired));

  previewResult.textContent = result;
  
  // Debugging log to help troubleshoot
  console.log({
    extractedEmail: email,
    extractedPassword: password,
    extractedProfile: profile,
    extractedPin: pin,
    tanggal: formatTanggal(now),
    expired: formatTanggal(expired)
  });
}

// Save template to server - PERBAIKAN: Format data yang benar
async function saveTemplate() {
  const name = document.getElementById('templateName').value.trim();
  const durationType = document.getElementById('durationType').value;
  const durationValue = parseInt(document.getElementById('durationValue').value);
  const format = document.getElementById('templateBody').value.trim();
  
  // Convert Set to Array
  const keywords = Array.from(detectedKeywords);
  
  if (!name || !durationType || isNaN(durationValue) || !format || keywords.length === 0) {
    templateMsg.textContent = 'Mohon lengkapi semua field dan ekstrak kata kunci';
    templateMsg.className = 'message error';
    return;
  }
  
  // PERBAIKAN: Format data yang diharapkan server
  const templateData = {
    name: name,
    keywords: keywords,
    duration: durationType,
    format: format
  };
  
  try {
    saveTemplateBtn.disabled = true;
    saveTemplateBtn.textContent = 'Menyimpan...';
    
    console.log('Sending data:', JSON.stringify(templateData));
    
    const res = await fetch('/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templateData)
    });
    
    const data = await res.json();
    console.log('Response:', data);
    
    if (data.success) {
      templateMsg.textContent = 'Template berhasil disimpan ✅';
      templateMsg.className = 'message success';
      
      // Memuat kembali daftar template setelah berhasil menyimpan
      loadTemplates();
    } else {
      templateMsg.textContent = 'Gagal menyimpan template: ' + (data.message || 'Terjadi kesalahan');
      templateMsg.className = 'message error';
    }
  } catch (err) {
    console.error('Error saving template:', err);
    templateMsg.textContent = 'Terjadi kesalahan saat menyimpan';
    templateMsg.className = 'message error';
  } finally {
    saveTemplateBtn.disabled = false;
    saveTemplateBtn.textContent = 'Simpan Template';
  }
}

// PERBAIKAN: Load all templates from server dengan error handling yang lebih baik
async function loadTemplates() {
  const templateListContainer = document.getElementById('templateListContainer');
  if (!templateListContainer) {
    console.error('Element templateListContainer tidak ditemukan');
    return;
  }
  
  templateListContainer.innerHTML = '<p class="loading-text"><i class="fas fa-spinner fa-spin"></i> Memuat daftar template...</p>';
  
  try {
    console.log('Memuat daftar template...');
    const res = await fetch('/templates');
    
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Respons server bukan JSON yang valid');
    }
    
    const data = await res.json();
    console.log('Template data received:', data);
    
    if (data.success) {
      templatesData = data.templates || {};
      displayTemplates(templatesData);
    } else {
      templateListContainer.innerHTML = `<p class="error-text">Gagal memuat template: ${data.message || 'Terjadi kesalahan'}</p>`;
    }
  } catch (err) {
    console.error('Error loading templates:', err);
    templateListContainer.innerHTML = `<p class="error-text">Terjadi kesalahan saat memuat template: ${err.message}</p>`;
  }
}

// Display templates in the template list tab
function displayTemplates(templates) {
  const templateListContainer = document.getElementById('templateListContainer');
  
  // Check if there are templates
  if (!templates || Object.keys(templates).length === 0) {
    templateListContainer.innerHTML = '<div class="empty-list">Belum ada template tersimpan</div>';
    return;
  }
  
  // Clear container
  templateListContainer.innerHTML = '';
  
  // Add each template as a card
  Object.entries(templates).forEach(([name, template]) => {
    // Validasi data template
    if (!template) {
      console.error(`Template ${name} memiliki data yang tidak valid`, template);
      return;
    }
    
    const templateCard = document.createElement('div');
    templateCard.className = 'template-card';
    
    // Format the duration text
    let durationType = 'hari';
    let durationValue = 1;
    
    // PERBAIKAN: Handling untuk format duration yang berbeda
    if (typeof template.duration === 'object' && template.duration !== null) {
      durationType = template.duration.type || 'hari';
      durationValue = template.duration.value || 1;
    } else if (typeof template.duration === 'string') {
      durationType = template.duration;
      durationValue = 1;
    }
    
    let durationText = '';
    switch(durationType) {
      case 'hari':
        durationText = `${durationValue} hari`;
        break;
      case 'bulan':
        durationText = `${durationValue} bulan`;
        break;
      case 'tahun':
        durationText = `${durationValue} tahun`;
        break;
      default:
        durationText = `${durationValue} ${durationType}`;
    }
    
    // Create keywords HTML - pastikan keywords adalah array
    const keywords = Array.isArray(template.keywords) ? template.keywords : [];
    const keywordsHTML = keywords.map(keyword => 
      `<span class="template-card-keyword">{${keyword}}</span>`
    ).join('');
    
    // Format tanggal update jika ada
    const updatedDate = template.updatedAt ? new Date(template.updatedAt) : new Date();
    
    // Set template card content
    templateCard.innerHTML = `
      <div class="template-card-header">
        <div class="template-card-title">${name}</div>
        <div class="template-card-actions">
          <button class="template-card-action edit" data-name="${name}" title="Edit Template">✏️</button>
          <button class="template-card-action use" data-name="${name}" title="Gunakan Template">✓</button>
          <button class="template-card-action delete" data-name="${name}" title="Hapus Template">🗑️</button>
        </div>
      </div>
      <div class="template-card-info">
        <span>Durasi: ${durationText}</span>
        <span>Update: ${updatedDate.toLocaleDateString('id-ID')}</span>
      </div>
      <div class="template-card-keywords">
        ${keywordsHTML}
      </div>
    `;
    
    // Add template card to container
    templateListContainer.appendChild(templateCard);
    
    // Add event listeners to template card buttons
    const useButton = templateCard.querySelector('.template-card-action.use');
    const editButton = templateCard.querySelector('.template-card-action.edit');
    const deleteButton = templateCard.querySelector('.template-card-action.delete');
    
    if (useButton) useButton.addEventListener('click', () => useTemplate(name));
    if (editButton) editButton.addEventListener('click', () => editTemplate(name));
    if (deleteButton) deleteButton.addEventListener('click', () => deleteTemplate(name));
  });
}

// Use a template to fill the template editor form
function useTemplate(templateName) {
  const template = templatesData[templateName];
  if (!template) {
    alert('Template tidak ditemukan');
    return;
  }
  
  // Switch to template editor tab
  document.querySelector('.sidebar-link[data-tab="template-editor"]').click();
  
  // Fill the form with template data
  document.getElementById('templateName').value = templateName;
  
  // PERBAIKAN: Handle berbagai format data duration
  if (typeof template.duration === 'object' && template.duration !== null) {
    document.getElementById('durationType').value = template.duration.type || 'hari';
    document.getElementById('durationValue').value = template.duration.value || 1;
  } else if (typeof template.duration === 'string') {
    document.getElementById('durationType').value = template.duration;
    document.getElementById('durationValue').value = 1;
  }
  
  document.getElementById('templateBody').value = template.format;
  
  // Update detected keywords
  detectedKeywords = new Set(Array.isArray(template.keywords) ? template.keywords : []);
  updateKeywordsUI();
  
  // Show success message
  templateMsg.textContent = `Template "${templateName}" berhasil dimuat`;
  templateMsg.className = 'message success';
  setTimeout(() => { templateMsg.textContent = ''; templateMsg.className = 'message'; }, 3000);
}

// Edit a template (same as use but with a different message)
function editTemplate(templateName) {
  useTemplate(templateName);
  templateMsg.textContent = `Mengedit template "${templateName}"`;
  templateMsg.className = 'message';
}

// Delete a template
async function deleteTemplate(templateName) {
  if (!confirm(`Yakin ingin menghapus template "${templateName}"?`)) {
    return;
  }
  
  try {
    const res = await fetch(`/templates/${encodeURIComponent(templateName)}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    
    if (data.success) {
      // Reload templates
      loadTemplates();
      
      // Show success message
      const messageElement = document.createElement('div');
      messageElement.className = 'message success';
      messageElement.textContent = `Template "${templateName}" berhasil dihapus`;
      document.getElementById('template-list').appendChild(messageElement);
      
      setTimeout(() => {
        messageElement.remove();
      }, 3000);
    } else {
      alert('Gagal menghapus template: ' + (data.message || 'Terjadi kesalahan'));
    }
  } catch (err) {
    console.error('Error deleting template:', err);
    alert('Terjadi kesalahan saat menghapus template');
  }
}

// Add event listeners
if (toggleBtn) toggleBtn.addEventListener('click', toggleBot);
if (logoutBtn) logoutBtn.addEventListener('click', logout);
if (extractKeysBtn) extractKeysBtn.addEventListener('click', extractKeywords);
if (previewBtn) previewBtn.addEventListener('click', generatePreview);
if (saveTemplateBtn) saveTemplateBtn.addEventListener('click', saveTemplate);
if (sendMessageBtn) sendMessageBtn.addEventListener('click', sendMessage);
if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
if (pasteBtn) pasteBtn.addEventListener('click', pasteFromClipboard);

// PERBAIKAN: Tambahkan event listener untuk pencarian template
const searchTemplateInput = document.getElementById('searchTemplate');
if (searchTemplateInput) {
  searchTemplateInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    
    // Filter template yang sudah dimuat berdasarkan query pencarian
    if (templatesData && Object.keys(templatesData).length > 0) {
      const filteredTemplates = {};
      
      Object.entries(templatesData).forEach(([name, data]) => {
        if (name.toLowerCase().includes(searchTerm)) {
          filteredTemplates[name] = data;
        }
      });
      
      // Tampilkan template yang terfilter
      displayTemplates(filteredTemplates);
    }
  });
}

// Initialize the dashboard
checkStatus();

// PERBAIKAN: Load templates pada saat halaman dimuat
window.addEventListener('DOMContentLoaded', () => {
  // Check jika tab template-list sedang aktif
  const activeTab = document.querySelector('.sidebar-link.active');
  if (activeTab && activeTab.getAttribute('data-tab') === 'template-list') {
    loadTemplates();
  }
  
  // Tambahkan logging untuk debugging
  console.log('Dashboard initialized');
});