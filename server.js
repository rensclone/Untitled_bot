const messageSender = require('./message-sender');
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { exec } = require('child_process');
const { getAllMessageHistory, getFilteredMessageHistory } = require('./message-history');

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'rahasia-bot-wa',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

function isAuthenticated(req, res, next) {
  if (req.session && req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (req.session && req.session.loggedIn) {
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/login.html');
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  try {
    const users = JSON.parse(fs.readFileSync('./users.json'));
    const match = users.find(u => u.username === username && u.password === password);
    if (match) {
      req.session.loggedIn = true;
      return res.json({ success: true });
    }
    return res.json({ success: false, message: 'username atau password salah' });
  } catch (err) {
    console.error('Error pada proses login:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Terjadi kesalahan pada server' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

app.get('/dashboard.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

app.post('/start-bot', isAuthenticated, (req, res) => {
  exec('pm2 start bot.js --name bot-wa', (error, stdout, stderr) => {
    if (error) {
      console.error('Error starting bot:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true, message: 'Bot berhasil dinyalakan' });
  });
});

app.post('/stop-bot', isAuthenticated, (req, res) => {
  exec('pm2 stop bot-wa', (error, stdout, stderr) => {
    if (error) {
      console.error('Error stopping bot:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.json({ success: true, message: 'Bot berhasil dimatikan' });
  });
});

app.get('/status', isAuthenticated, (req, res) => {
  exec('pm2 jlist', (error, stdout, stderr) => {
    if (error) {
      console.error('Error checking status:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
    try {
      const list = JSON.parse(stdout);
      const bot = list.find(proc => proc.name === 'bot-wa');
      const isRunning = bot && bot.pm2_env.status === 'online';
      return res.json({ success: true, status: isRunning ? 'online' : 'offline' });
    } catch (err) {
      console.error('Error parsing PM2 status:', err);
      return res.status(500).json({ success: false, message: 'Gagal parsing status.' });
    }
  });
});

// Endpoint untuk menyimpan atau memperbarui template
app.post('/templates', isAuthenticated, (req, res) => {
  console.log('Template request body:', req.body);
  const { name, keywords, duration, format } = req.body;
  
  // Validasi input
  if (!name || !keywords || !duration || !format) {
    console.error('Validasi gagal:', { name, keywords, duration, format });
    return res.status(400).json({ 
      success: false, 
      message: 'Semua field harus diisi' 
    });
  }
  
  try {
    const filePath = path.join(__dirname, 'templates.json');
    let templates = {};
    
    // Baca file template jika ada
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        if (fileContent.trim()) {
          templates = JSON.parse(fileContent);
        }
      } catch (parseErr) {
        console.error('Error parsing templates file:', parseErr);
        // Jika file rusak, buat baru
      }
    }
    
    console.log('Templates sebelum ditambahkan:', templates);
    
    // Format durasi sesuai dengan yang dibutuhkan dashboard.js
    // PERBAIKAN: Format duration harus sebagai object dengan type dan value
    let formattedDuration = duration;
    if (typeof duration === 'string') {
      // Jika format lama (string), konversi ke format baru (object)
      const durationValue = req.body.durationValue || 1; // Default ke 1 jika tidak ada
      formattedDuration = {
        type: duration,
        value: parseInt(durationValue)
      };
    }
    
    // Tambahkan template baru
    templates[name] = { 
      keywords: Array.isArray(keywords) ? keywords : [keywords], // Pastikan keywords adalah array
      duration: formattedDuration,
      format,
      updatedAt: new Date().toISOString()
    };
    
    console.log('Templates setelah ditambahkan:', templates);
    
    // Simpan ke file
    fs.writeFileSync(filePath, JSON.stringify(templates, null, 2));
    console.log('File berhasil disimpan di:', filePath);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving template:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menyimpan template: ' + err.message 
    });
  }
});

// Tambahkan route API untuk mengirim pesan WhatsApp
app.post('/send-message', isAuthenticated, async (req, res) => {
  try {
    const { targetNumber, message } = req.body;

    console.log(`📨 Request pengiriman pesan:`, { targetNumber, messageLength: message?.length });

    // Validasi input
    if (!targetNumber || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nomor tujuan dan pesan harus diisi' 
      });
    }
    
    // Validasi format nomor
    const numberRegex = /^(?:0|62|\+62)?[0-9]{9,12}$/;
    const cleanNumber = targetNumber.replace(/[^\d]/g, '');
    
    if (!numberRegex.test(cleanNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Format nomor WhatsApp tidak valid. Gunakan format: 08xxx atau 628xxx'
      });
    }
    
    // Validasi panjang pesan
    if (message.length > 4096) {
      return res.status(400).json({
        success: false,
        message: 'Pesan terlalu panjang. Maksimal 4096 karakter'
      });
    }
    
    // Cek status bot
    const botRunning = await messageSender.isBotRunning();
    if (!botRunning) {
      return res.status(503).json({
        success: false,
        message: 'Bot WhatsApp tidak aktif. Silakan aktifkan bot terlebih dahulu.'
      });
    }
    
     const responseTimeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          message: 'Timeout: Pesan mungkin terkirim tapi tidak dapat dikonfirmasi dalam waktu yang ditentukan'
        });
      }
    }, 50000);
    
    try {
      // Kirim pesan dengan waitForDelivery = true
      const result = await messageSender.sendWhatsAppMessage(cleanNumber, message, true);
      
      // Clear timeout jika berhasil
      clearTimeout(responseTimeout);
      
      // Pastikan response belum dikirim
      if (!res.headersSent) {
        // Log aktivitas
        console.log(`📤 Pesan berhasil dikirim ke ${result.data.targetNumber} pada ${result.data.timestamp}`);
        
        res.json({ 
          success: true, 
          message: 'Pesan berhasil dikirim',
          data: {
            targetNumber: result.data.targetNumber,
            timestamp: result.data.timestamp,
            status: result.data.status
          }
        });
      }
    } catch (sendError) {
      // Clear timeout jika ada error
      clearTimeout(responseTimeout);
      
      // Pastikan response belum dikirim
      if (!res.headersSent) {
        throw sendError;
      }
    }
    
   } catch (error) {
    console.error('Error sending message:', error);
    
    // Pastikan response belum dikirim sebelum mengirim error response
    if (!res.headersSent) {
      // Tentukan status code berdasarkan jenis error
      let statusCode = 500;
      let errorMessage = 'Terjadi kesalahan saat mengirim pesan';
      
      if (error.message.includes('format')) {
        statusCode = 400;
        errorMessage = error.message;
      } else if (error.message.includes('tidak aktif')) {
        statusCode = 503;
        errorMessage = error.message;
      } else if (error.message.includes('Timeout')) {
        statusCode = 408;
        errorMessage = 'Timeout: Pesan mungkin terkirim tapi tidak dapat dikonfirmasi dalam waktu yang ditentukan';
      }
      
      res.status(statusCode).json({ 
        success: false, 
        message: errorMessage,
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
});

// Endpoint untuk mendapatkan semua template
app.get('/templates', isAuthenticated, (req, res) => {
  try {
    const filePath = path.join(__dirname, 'templates.json');
    if (!fs.existsSync(filePath)) {
      return res.json({ success: true, templates: {} });
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent.trim()) {
      return res.json({ success: true, templates: {} });
    }
    
    const templates = JSON.parse(fileContent);
    
    // Pastikan format setiap template sesuai dengan yang diharapkan
    Object.keys(templates).forEach(name => {
      const template = templates[name];
      
      // Pastikan keywords adalah array
      if (!Array.isArray(template.keywords)) {
        template.keywords = template.keywords ? [template.keywords] : [];
      }
      
      // Pastikan duration dalam format yang benar
      if (typeof template.duration === 'string') {
        template.duration = {
          type: template.duration,
          value: 1
        };
      } else if (!template.duration || typeof template.duration !== 'object') {
        template.duration = {
          type: 'hari',
          value: 1
        };
      }
      
      // Tambahkan updatedAt jika tidak ada
      if (!template.updatedAt) {
        template.updatedAt = new Date().toISOString();
      }
    });
    
    res.setHeader('Content-Type', 'application/json');
    res.json({ success: true, templates });
  } catch (err) {
    console.error('Error reading templates:', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      success: false, 
      message: 'Gagal membaca template: ' + err.message 
    });
  }
});

// Endpoint untuk mendapatkan template tertentu
app.get('/templates/:name', isAuthenticated, (req, res) => {
  try {
    const { name } = req.params;
    const filePath = path.join(__dirname, 'templates.json');
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        success: false, 
        message: 'Template tidak ditemukan' 
      });
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent.trim()) {
      return res.status(404).json({ 
        success: false, 
        message: 'Template tidak ditemukan' 
      });
    }
    
    const templates = JSON.parse(fileContent);
    if (!templates[name]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Template tidak ditemukan' 
      });
    }
    
    const template = templates[name];
    
    // PERBAIKAN: Pastikan format template sesuai yang diharapkan
    if (!Array.isArray(template.keywords)) {
      template.keywords = template.keywords ? [template.keywords] : [];
    }
    
    if (typeof template.duration === 'string') {
      template.duration = {
        type: template.duration,
        value: 1
      };
    }
    
    res.json({ success: true, template });
  } catch (err) {
    console.error('Error getting template:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mendapatkan template: ' + err.message 
    });
  }
});

// Endpoint untuk menghapus template
app.delete('/templates/:name', isAuthenticated, (req, res) => {
  try {
    const { name } = req.params;
    const filePath = path.join(__dirname, 'templates.json');
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        success: false, 
        message: 'Template tidak ditemukan' 
      });
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent.trim()) {
      return res.status(404).json({ 
        success: false, 
        message: 'Template tidak ditemukan' 
      });
    }
    
    const templates = JSON.parse(fileContent);
    if (!templates[name]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Template tidak ditemukan' 
      });
    }
    
    delete templates[name];
    fs.writeFileSync(filePath, JSON.stringify(templates, null, 2));
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting template:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menghapus template: ' + err.message 
    });
  }
});

// Membuat file history jika belum ada
const historyFilePath = path.join(__dirname, 'message-history.json');
if (!fs.existsSync(historyFilePath)) {
  fs.writeFileSync(historyFilePath, JSON.stringify([], null, 2));
}

// Endpoint untuk menyimpan history pesan
app.post('/message-history', isAuthenticated, (req, res) => {
  try {
    const { templateName, targetNumber, messageContent } = req.body;
    
    if (!targetNumber || !messageContent) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nomor tujuan dan pesan harus diisi' 
      });
    }
    
    const messageData = {
      targetNumber,
      message: messageContent,
      template: templateName,
      status: 'sent',
      timestamp: new Date().toISOString()
    };
    
    const historyFilePath = path.join(__dirname, 'message-history.json');
    let historyData = { messages: [] };
    
    // Baca file history jika ada
    if (fs.existsSync(historyFilePath)) {
      const fileContent = fs.readFileSync(historyFilePath, 'utf8');
      if (fileContent.trim()) {
        historyData = JSON.parse(fileContent);
      }
    }
    
    // Tambahkan pesan baru
    historyData.messages.push(messageData);
    
    // Simpan ke file
    fs.writeFileSync(historyFilePath, JSON.stringify(historyData, null, 2));
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving message history:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menyimpan history pesan: ' + err.message 
    });
  }
});

// Endpoint untuk mendapatkan history pesan
app.get('/message-history', isAuthenticated, (req, res) => {
  try {
    const { status, startDate, endDate, targetNumber } = req.query;
    const filter = {};
    
    if (status) filter.status = status;
    if (startDate && endDate) {
      filter.startDate = startDate;
      filter.endDate = endDate;
    }
    if (targetNumber) filter.targetNumber = targetNumber;
    
    const historyFilePath = path.join(__dirname, 'message-history.json');
    if (!fs.existsSync(historyFilePath)) {
      res.setHeader('Content-Type', 'application/json');
      return res.json({ success: true, messages: [] });
    }
    
    const fileContent = fs.readFileSync(historyFilePath, 'utf8');
    if (!fileContent.trim()) {
      res.setHeader('Content-Type', 'application/json');
      return res.json({ success: true, messages: [] });
    }
    
    const historyData = JSON.parse(fileContent);
    let messages = historyData.messages || [];
    
    // Filter berdasarkan status
    if (filter.status) {
      messages = messages.filter(msg => msg.status === filter.status);
    }
    
    // Filter berdasarkan tanggal
    if (filter.startDate && filter.endDate) {
      messages = messages.filter(msg => {
        const sentDate = new Date(msg.sentAt || msg.timestamp);
        return sentDate >= new Date(filter.startDate) && 
               sentDate <= new Date(filter.endDate);
      });
    }
    
    // Filter berdasarkan nomor target
    if (filter.targetNumber) {
      messages = messages.filter(msg => 
        msg.targetNumber.includes(filter.targetNumber)
      );
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.json({ success: true, messages });
  } catch (err) {
    console.error('Error getting message history:', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil history pesan: ' + err.message 
    });
  }
});

// Endpoint untuk menghapus history pesan
app.delete('/message-history', isAuthenticated, (req, res) => {
  try {
    const historyFilePath = path.join(__dirname, 'message-history.json');
    
    // Buat file history baru dengan array kosong
    fs.writeFileSync(historyFilePath, JSON.stringify({ messages: [] }, null, 2));
    
    res.setHeader('Content-Type', 'application/json');
    res.json({ success: true, message: 'History pesan berhasil dihapus' });
  } catch (err) {
    console.error('Error deleting message history:', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menghapus history pesan: ' + err.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ UI Admin berjalan di http://localhost:${PORT}`);
});