// message-sender.js - Versi yang diperbaiki untuk mengatasi error format nomor dan timeout

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { saveMessageToHistory } = require('./message-history');

// Fungsi untuk memeriksa apakah bot sedang berjalan
function isBotRunning() {
  return new Promise((resolve, reject) => {
    exec('pm2 jlist', (error, stdout, stderr) => {
      if (error) {
        console.error('Error checking bot status:', error);
        return reject(error);
      }
      
      try {
        const list = JSON.parse(stdout);
        const bot = list.find(proc => proc.name === 'bot-wa');
        const isRunning = bot && bot.pm2_env.status === 'online';
        resolve(isRunning);
      } catch (err) {
        console.error('Error parsing PM2 status:', err);
        reject(err);
      }
    });
  });
}

// Map untuk tracking status pengiriman pesan dengan timeout otomatis
const messageStatus = new Map();

// Fungsi untuk format nomor yang diperbaiki dan lebih robust
function formatWhatsAppNumber(number) {
  if (!number) {
    throw new Error('Nomor tidak boleh kosong');
  }

  let formattedNumber = number.toString().trim();
  
  console.log(`🔍 Memformat nomor: ${formattedNumber}`);
  
  // Jika sudah dalam format JID (@s.whatsapp.net), validasi dan return
  if (formattedNumber.includes('@')) {
    if (formattedNumber.endsWith('@s.whatsapp.net')) {
      const numberPart = formattedNumber.replace('@s.whatsapp.net', '');
      // Validasi bahwa bagian nomor hanya mengandung digit
      if (!/^\d+$/.test(numberPart)) {
        throw new Error('Format nomor WhatsApp tidak valid: bagian nomor harus berupa angka');
      }
      
      // Validasi panjang nomor
      if (numberPart.length < 10 || numberPart.length > 15) {
        throw new Error('Panjang nomor tidak valid: harus 10-15 digit');
      }
      
      console.log(`✅ Format JID valid: ${formattedNumber}`);
      return formattedNumber;
    } else {
      throw new Error('Format nomor WhatsApp tidak valid: harus berakhiran @s.whatsapp.net');
    }
  }
  
  // Hapus semua karakter non-numerik
  formattedNumber = formattedNumber.replace(/[^\d]/g, '');
  
  // Validasi panjang nomor mentah sebelum formatting
  if (formattedNumber.length < 8 || formattedNumber.length > 15) {
    throw new Error(`Panjang nomor tidak valid: ${formattedNumber.length} digit. Harus 8-15 digit`);
  }
  
  // Normalisasi nomor Indonesia dengan logika yang diperbaiki
  if (formattedNumber.startsWith('0')) {
    // Nomor lokal Indonesia (08xxx -> 628xxx)
    formattedNumber = '62' + formattedNumber.substring(1);
    console.log(`📱 Konversi nomor lokal: 0${formattedNumber.substring(2)} -> ${formattedNumber}`);
  } else if (formattedNumber.startsWith('8') && !formattedNumber.startsWith('62')) {
    // Nomor tanpa kode negara dan tanpa 0 (8xxx -> 628xxx)
    // Hanya untuk nomor yang panjangnya masuk akal untuk Indonesia (8-12 digit)
    if (formattedNumber.length >= 8 && formattedNumber.length <= 12) {
      formattedNumber = '62' + formattedNumber;
      console.log(`📱 Konversi nomor tanpa kode: 8${formattedNumber.substring(3)} -> ${formattedNumber}`);
    }
  } else if (!formattedNumber.startsWith('62') && formattedNumber.length >= 8 && formattedNumber.length <= 13) {
    // Untuk nomor yang tidak dimulai dengan 62 tapi panjangnya sesuai, coba tambahkan 62
    // Namun hanya jika digit pertama adalah 8 atau 1-9 (untuk menghindari kesalahan)
    if (formattedNumber.startsWith('8') || formattedNumber.startsWith('1') || 
        formattedNumber.startsWith('2') || formattedNumber.startsWith('3') ||
        formattedNumber.startsWith('5') || formattedNumber.startsWith('7') ||
        formattedNumber.startsWith('9')) {
      const originalNumber = formattedNumber;
      formattedNumber = '62' + formattedNumber;
      console.log(`📱 Asumsi nomor Indonesia: ${originalNumber} -> ${formattedNumber}`);
    }
  }
  
  // Validasi final untuk nomor Indonesia
  if (formattedNumber.startsWith('62')) {
    // Nomor Indonesia harus: 62 + 8-13 digit = 10-15 total digit
    if (formattedNumber.length < 10 || formattedNumber.length > 15) {
      throw new Error(`Panjang nomor Indonesia tidak valid: ${formattedNumber.length} digit. Harus 10-15 digit setelah kode negara`);
    }
    
    // Validasi digit ketiga harus 8 untuk nomor seluler Indonesia
    if (formattedNumber.length >= 3 && formattedNumber.charAt(2) !== '8') {
      console.warn(`⚠️ Nomor ${formattedNumber} mungkin bukan nomor seluler Indonesia (digit ke-3 bukan 8)`);
    }
    
    // Validasi prefix operator Indonesia yang umum untuk nomor seluler
    const validPrefixes = [
      '6281', '6282', '6283', '6285', '6287', '6288', '6289', // Telkomsel
      '6277', '6278', // XL Axiata  
      '6285', '6286', '6287', '6288', // Indosat Ooredoo (beberapa overlap dengan Telkomsel)
      '6289', // 3 (Three)
      '6277', // Smartfren
      '6285', '6286', '6287', '6288', '6289' // Tambahan prefix umum
    ];
    
    const prefix4 = formattedNumber.substring(0, 4);
    const hasValidPrefix = validPrefixes.includes(prefix4) || formattedNumber.startsWith('628');
    
    if (!hasValidPrefix) {
      console.warn(`⚠️ Prefix ${prefix4} mungkin bukan operator seluler Indonesia yang umum, tapi tetap diproses`);
    }
    
  } else {
    // Untuk nomor internasional non-Indonesia
    if (formattedNumber.length < 8 || formattedNumber.length > 15) {
      throw new Error(`Panjang nomor internasional tidak valid: ${formattedNumber.length} digit. Harus 8-15 digit`);
    }
  }
  
  const finalNumber = `${formattedNumber}@s.whatsapp.net`;
  console.log(`✅ Nomor berhasil diformat: ${number} -> ${finalNumber} (${formattedNumber.length} digit)`);
  
  return finalNumber;
}

// Fungsi untuk mengirim pesan melalui bot WhatsApp dengan timeout yang diperbaiki
function sendWhatsAppMessage(targetNumber, message, waitForDelivery = false) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`📤 Mulai proses pengiriman ke: ${targetNumber}`);
      
      // Validasi input yang lebih ketat
      if (!targetNumber || typeof targetNumber !== 'string' || targetNumber.trim() === '') {
        throw new Error('Nomor tujuan harus diisi dan berupa string yang valid');
      }
      
      if (!message || typeof message !== 'string' || message.trim() === '') {
        throw new Error('Pesan harus diisi dan berupa string yang valid');
      }
      
      // Batasi panjang pesan
      if (message.length > 4096) {
        throw new Error('Pesan terlalu panjang. Maksimal 4096 karakter');
      }
      
      // Periksa apakah bot sedang berjalan
      console.log('🔍 Memeriksa status bot...');
      const botRunning = await isBotRunning();
      if (!botRunning) {
        throw new Error('Bot WhatsApp tidak aktif. Silakan aktifkan bot terlebih dahulu.');
      }
      console.log('✅ Bot WhatsApp aktif');
      
      // Format nomor dengan error handling yang lebih baik
      let formattedNumber;
      try {
        formattedNumber = formatWhatsAppNumber(targetNumber);
      } catch (formatError) {
        console.error(`❌ Error format nomor:`, formatError);
        throw new Error(`Format nomor tidak valid: ${formatError.message}`);
      }
      
      // Buat timestamp yang konsisten dengan presisi millisecond
      const timestamp = Date.now();
      const timestampISO = new Date(timestamp).toISOString();
      
      // Buat data pesan dengan informasi lengkap
      const messageData = {
        targetNumber: formattedNumber,
        originalNumber: targetNumber, // Simpan nomor asli untuk referensi
        message: message.trim(),
        timestamp: timestampISO,
        timestampMs: timestamp,
        status: 'sent',
        createdAt: timestampISO,
        source: 'api'
      };
      
      const outboxDir = path.join(__dirname, 'outbox');
      
      // Buat direktori outbox jika belum ada
      if (!fs.existsSync(outboxDir)) {
        fs.mkdirSync(outboxDir, { recursive: true });
        console.log('📁 Direktori outbox dibuat');
      }
      
      // Pastikan direktori dapat ditulisi
      try {
        const testFile = path.join(outboxDir, '.test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch (error) {
        throw new Error(`Tidak dapat menulis ke direktori outbox: ${error.message}`);
      }
      
      // Buat nama file unik dengan timestamp yang lebih spesifik dan random string
      const randomString = Math.random().toString(36).substring(2, 8);
      const fileName = `message_${timestamp}_${randomString}.json`;
      const messageFilePath = path.join(outboxDir, fileName);
      
      // Cegah duplikasi file
      if (fs.existsSync(messageFilePath)) {
        throw new Error('File pesan sudah ada, coba lagi dalam beberapa detik');
      }
      
      // Tulis file pesan
      fs.writeFileSync(messageFilePath, JSON.stringify(messageData, null, 2));
      
      console.log(`📝 File pesan dibuat: ${fileName}`);
      console.log(`📤 Pesan ditambahkan ke antrian: ${formattedNumber}`);
      
      // Jika waitForDelivery = true, tunggu hingga pesan terproses
      if (waitForDelivery) {
        const messageId = `${formattedNumber}_${timestamp}`;
        
        console.log(`⏳ Menunggu konfirmasi pengiriman untuk: ${messageId}`);
        
        // Set timeout untuk menunggu pengiriman (diperpanjang menjadi 45 detik)
        const timeout = setTimeout(() => {
          const status = messageStatus.get(messageId);
          messageStatus.delete(messageId);
          
          console.log(`⚠️ Timeout menunggu konfirmasi untuk ${messageId}`);
          
          // Periksa apakah file masih ada di outbox (artinya belum diproses)
          if (fs.existsSync(messageFilePath)) {
            console.log(`❌ File masih di outbox, kemungkinan gagal diproses`);
            reject(new Error('Timeout: Pesan gagal dikirim dalam batas waktu yang ditentukan. Periksa koneksi WhatsApp dan format nomor.'));
          } else {
            console.log(`✅ File sudah diproses, diasumsikan berhasil`);
            resolve({
              success: true,
              message: 'Pesan berhasil dikirim (timeout konfirmasi)',
              data: {
                targetNumber: formattedNumber,
                originalNumber: targetNumber,
                timestamp: timestampISO,
                fileName: fileName,
                status: 'sent_assumed'
              }
            });
          }
        }, 45000); // Diperpanjang menjadi 45 detik
        
        // Polling untuk mengecek status pengiriman dengan interval yang lebih optimal
        const maxAttempts = 30; // 30 attempts x 1.5 detik = 45 detik
        let attempts = 0;
        
        const checkStatus = setInterval(() => {
          attempts++;
          const status = messageStatus.get(messageId);
          
          // Juga periksa apakah file masih ada di outbox
          const fileStillExists = fs.existsSync(messageFilePath);
          
          if (status || attempts >= maxAttempts || !fileStillExists) {
            clearInterval(checkStatus);
            clearTimeout(timeout);
            
            if (status) {
              messageStatus.delete(messageId);
              
              if (status.success) {
                console.log(`✅ Konfirmasi diterima: pesan berhasil dikirim`);
                resolve({
                  success: true,
                  message: 'Pesan berhasil dikirim',
                  data: {
                    targetNumber: formattedNumber,
                    originalNumber: targetNumber,
                    timestamp: status.sentAt || timestampISO,
                    fileName: fileName,
                    status: 'sent'
                  }
                });
              } else {
                console.log(`❌ Konfirmasi diterima: pesan gagal dikirim - ${status.error}`);
                reject(new Error(status.error || 'Gagal mengirim pesan'));
              }
            } else if (!fileStillExists && attempts < maxAttempts) {
              // File sudah diproses tapi belum ada konfirmasi status, asumsikan berhasil
              console.log(`✅ File sudah diproses, diasumsikan berhasil`);
              resolve({
                success: true,
                message: 'Pesan berhasil dikirim (file processed)',
                data: {
                  targetNumber: formattedNumber,
                  originalNumber: targetNumber,
                  timestamp: timestampISO,
                  fileName: fileName,
                  status: 'sent_processed'
                }
              });
            }
            // Jika tidak ada status dan sudah max attempts, timeout handler akan menangani
          }
        }, 1500); // Check setiap 1.5 detik
        
      } else {
        // Mode default: langsung return success setelah file dibuat
        resolve({ 
          success: true, 
          message: 'Pesan berhasil ditambahkan ke antrian pengiriman',
          data: {
            targetNumber: formattedNumber,
            originalNumber: targetNumber,
            timestamp: timestampISO,
            fileName: fileName,
            status: 'queued'
          }
        });
      }
      
    } catch (error) {
      console.error('❌ Error sending WhatsApp message:', error);
      reject(error);
    }
  });
}

// Fungsi untuk update status pengiriman (dipanggil dari outbox-processor)
function updateMessageStatus(targetNumber, timestampMs, success, error = null, sentAt = null) {
  const messageId = `${targetNumber}_${timestampMs}`;
  
  console.log(`📊 Update status: ${messageId} -> ${success ? 'SUCCESS' : 'FAILED'}`);
  
  messageStatus.set(messageId, {
    success,
    error,
    sentAt: sentAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  // Auto cleanup setelah 2 menit (diperpanjang untuk debugging)
  setTimeout(() => {
    if (messageStatus.has(messageId)) {
      console.log(`🧹 Cleanup status tracking: ${messageId}`);
      messageStatus.delete(messageId);
    }
  }, 120 * 1000); // 2 menit
}

// Fungsi untuk debugging - melihat status yang sedang ditunggu
function getWaitingMessages() {
  const waiting = [];
  messageStatus.forEach((status, messageId) => {
    waiting.push({
      messageId,
      status,
      waitingTime: new Date() - new Date(status.updatedAt || 0)
    });
  });
  return waiting;
}

// Fungsi untuk membersihkan status yang sudah lama (cleanup berkala)
function cleanupOldStatuses() {
  const now = new Date();
  const maxAge = 5 * 60 * 1000; // 5 menit
  
  messageStatus.forEach((status, messageId) => {
    const statusAge = now - new Date(status.updatedAt || 0);
    if (statusAge > maxAge) {
      console.log(`🧹 Cleanup old status: ${messageId}`);
      messageStatus.delete(messageId);
    }
  });
}

// Jalankan cleanup setiap 3 menit
setInterval(cleanupOldStatuses, 3 * 60 * 1000);

// Fungsi tambahan untuk testing validasi nomor
function testPhoneNumberValidation() {
  const testNumbers = [
    // Test cases untuk nomor 11 digit
    '08123456789',     // 11 digit lokal -> 628123456789 (12 digit)
    '8123456789',      // 10 digit -> 628123456789 (12 digit)
    
    // Test cases untuk nomor 12 digit  
    '081234567890',    // 12 digit lokal -> 6281234567890 (13 digit)
    '81234567890',     // 11 digit -> 6281234567890 (13 digit)
    
    // Test cases untuk nomor 13 digit
    '0812345678901',   // 13 digit lokal -> 62812345678901 (14 digit)
    '812345678901',    // 12 digit -> 62812345678901 (14 digit)
    
    // Test cases dengan kode negara
    '628123456789',    // 12 digit sudah dengan kode negara
    '6281234567890',   // 13 digit sudah dengan kode negara
    '62812345678901',  // 14 digit sudah dengan kode negara
    
    // Test cases dengan format JID
    '628123456789@s.whatsapp.net',
    '6281234567890@s.whatsapp.net',
    
    // Test edge cases
    '6277', // Terlalu pendek
    '62812345678901234567890', // Terlalu panjang
    '1234567890', // Nomor internasional
  ];
  
  console.log('\n🧪 Testing Phone Number Validation:');
  testNumbers.forEach(number => {
    try {
      const formatted = formatWhatsAppNumber(number);
      const numberPart = formatted.replace('@s.whatsapp.net', '');
      console.log(`✅ ${number} (${number.replace(/[^\d]/g, '').length} digit) -> ${formatted} (${numberPart.length} digit)`);
    } catch (error) {
      console.log(`❌ ${number} (${number.replace(/[^\d]/g, '').length} digit) -> ERROR: ${error.message}`);
    }
  });
}

// Fungsi untuk debugging masalah timeout
function debugTimeout() {
  console.log('\n🔍 Debug Timeout Status:');
  console.log('Waiting messages:', getWaitingMessages());
  console.log('Message status map size:', messageStatus.size);
}

module.exports = {
  sendWhatsAppMessage,
  isBotRunning,
  updateMessageStatus,
  getWaitingMessages,
  formatWhatsAppNumber,
  testPhoneNumberValidation,
  debugTimeout
};