// fix-pending-status.js - Perbaikan untuk status pending yang tidak terupdate

const fs = require('fs');
const path = require('path');
const { updateMessageStatus } = require('./message-sender');
const { saveMessageToHistory } = require('./message-history');

// Fungsi untuk membaca dan memperbaiki status pending
async function fixPendingStatus() {
  console.log('🔧 Memulai perbaikan status pending...');
  
  const sentDir = path.join(__dirname, 'outbox', 'sent');
  const historyFile = path.join(__dirname, 'data', 'message-history.json');
  
  try {
    // 1. Baca semua file dari direktori sent
    if (!fs.existsSync(sentDir)) {
      console.log('❌ Direktori sent tidak ditemukan');
      return;
    }
    
    const sentFiles = fs.readdirSync(sentDir).filter(file => file.endsWith('.json'));
    console.log(`📁 Ditemukan ${sentFiles.length} file di direktori sent`);
    
    // 2. Baca history yang ada
    let historyData = [];
    if (fs.existsSync(historyFile)) {
      const historyContent = fs.readFileSync(historyFile, 'utf8');
      historyData = JSON.parse(historyContent);
      console.log(`📚 Ditemukan ${historyData.length} record di history`);
    }
    
    // 3. Proses setiap file sent untuk update status
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const file of sentFiles) {
      try {
        const filePath = path.join(sentDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const messageData = JSON.parse(fileContent);
        
        console.log(`\n🔍 Memproses: ${file}`);
        console.log(`📞 Target: ${messageData.targetNumber || messageData.originalNumber}`);
        console.log(`⏰ Timestamp: ${messageData.timestampMs}`);
        console.log(`📊 Status saat ini: ${messageData.status}`);
        
        // Validasi data yang diperlukan
        if (!messageData.targetNumber && !messageData.originalNumber) {
          console.log(`⚠️ Skip: Tidak ada target number`);
          continue;
        }
        
        if (!messageData.timestampMs && !messageData.timestamp) {
          console.log(`⚠️ Skip: Tidak ada timestamp`);
          continue;
        }
        
        // Pastikan timestampMs ada
        if (!messageData.timestampMs && messageData.timestamp) {
          messageData.timestampMs = new Date(messageData.timestamp).getTime();
        }
        
        const targetNumber = messageData.targetNumber || messageData.originalNumber;
        const sentAt = messageData.sentAt || new Date().toISOString();
        
        // 4. Update status di database
        console.log(`📊 Mengupdate status database...`);
        try {
          const statusResult = await updateMessageStatus(
            targetNumber,
            messageData.timestampMs,
            true, // success = true
            null, // error = null
            sentAt
          );
          
          if (statusResult && statusResult.success !== false) {
            console.log(`✅ Status database berhasil diupdate`);
            
            // 5. Update history
            const historyIndex = historyData.findIndex(h => 
              h.timestampMs === messageData.timestampMs && 
              (h.targetNumber === targetNumber || h.originalNumber === targetNumber)
            );
            
            if (historyIndex !== -1) {
              // Update existing history record
              historyData[historyIndex] = {
                ...historyData[historyIndex],
                status: 'sent',
                sentAt: sentAt,
                fixedAt: new Date().toISOString(),
                fixedBy: 'fix-pending-status.js'
              };
              console.log(`✅ History record diupdate (index: ${historyIndex})`);
            } else {
              // Tambah history baru jika tidak ditemukan
              const newHistoryRecord = {
                ...messageData,
                status: 'sent',
                sentAt: sentAt,
                createdAt: new Date().toISOString(),
                fixedBy: 'fix-pending-status.js'
              };
              historyData.push(newHistoryRecord);
              console.log(`✅ History record baru ditambahkan`);
            }
            
            // Update file sent juga
            messageData.status = 'sent';
            messageData.fixedAt = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(messageData, null, 2));
            
            fixedCount++;
            
          } else {
            throw new Error('Status update returned false or null');
          }
          
        } catch (statusError) {
          console.error(`❌ Error update status: ${statusError.message}`);
          errorCount++;
        }
        
      } catch (fileError) {
        console.error(`❌ Error memproses file ${file}: ${fileError.message}`);
        errorCount++;
      }
    }
    
    // 6. Simpan history yang sudah diupdate
    if (fixedCount > 0) {
      // Backup history lama
      const backupFile = historyFile.replace('.json', `_backup_${Date.now()}.json`);
      if (fs.existsSync(historyFile)) {
        fs.copyFileSync(historyFile, backupFile);
        console.log(`💾 Backup history disimpan: ${backupFile}`);
      }
      
      // Simpan history baru
      fs.writeFileSync(historyFile, JSON.stringify(historyData, null, 2));
      console.log(`💾 History berhasil diupdate`);
    }
    
    console.log(`\n📊 HASIL PERBAIKAN:`);
    console.log(`✅ Berhasil diperbaiki: ${fixedCount}`);
    console.log(`❌ Error: ${errorCount}`);
    console.log(`📁 Total file diproses: ${sentFiles.length}`);
    
  } catch (error) {
    console.error('❌ Error dalam fixPendingStatus:', error);
    throw error;
  }
}

// Fungsi untuk memperbaiki status pending untuk nomor tertentu
async function fixSpecificNumber(phoneNumber, timestampMs) {
  console.log(`🔧 Memperbaiki status untuk nomor: ${phoneNumber}, timestamp: ${timestampMs}`);
  
  try {
    // Update status di database
    const statusResult = await updateMessageStatus(
      phoneNumber,
      timestampMs,
      true,
      null,
      new Date().toISOString()
    );
    
    if (statusResult && statusResult.success !== false) {
      console.log(`✅ Status berhasil diperbaiki untuk ${phoneNumber}`);
      
      // Update history
      const historyFile = path.join(__dirname, 'data', 'message-history.json');
      if (fs.existsSync(historyFile)) {
        const historyContent = fs.readFileSync(historyFile, 'utf8');
        const historyData = JSON.parse(historyContent);
        
        const historyIndex = historyData.findIndex(h => 
          h.timestampMs === timestampMs && 
          (h.targetNumber === phoneNumber || h.originalNumber === phoneNumber)
        );
        
        if (historyIndex !== -1) {
          historyData[historyIndex].status = 'sent';
          historyData[historyIndex].sentAt = new Date().toISOString();
          historyData[historyIndex].fixedAt = new Date().toISOString();
          
          fs.writeFileSync(historyFile, JSON.stringify(historyData, null, 2));
          console.log(`✅ History berhasil diupdate`);
        }
      }
      
      return true;
    } else {
      throw new Error('Status update failed');
    }
    
  } catch (error) {
    console.error(`❌ Error memperbaiki ${phoneNumber}:`, error.message);
    return false;
  }
}

// Fungsi untuk monitoring status real-time
function monitorStatusUpdates() {
  console.log('👀 Monitoring status updates...');
  
  const outboxDir = path.join(__dirname, 'outbox');
  const historyFile = path.join(__dirname, 'data', 'message-history.json');
  
  // Monitor perubahan file history
  if (fs.existsSync(historyFile)) {
    fs.watchFile(historyFile, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        console.log('📝 History file berubah, checking pending status...');
        setTimeout(() => {
          checkPendingInHistory().catch(console.error);
        }, 2000);
      }
    });
  }
  
  // Monitor direktori outbox
  if (fs.existsSync(outboxDir)) {
    fs.watch(outboxDir, (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        console.log(`📁 File outbox berubah: ${filename} (${eventType})`);
      }
    });
  }
}

// Fungsi untuk cek status pending di history
async function checkPendingInHistory() {
  const historyFile = path.join(__dirname, 'data', 'message-history.json');
  
  if (!fs.existsSync(historyFile)) {
    console.log('📚 History file tidak ditemukan');
    return;
  }
  
  try {
    const historyContent = fs.readFileSync(historyFile, 'utf8');
    const historyData = JSON.parse(historyContent);
    
    const pendingMessages = historyData.filter(msg => msg.status === 'pending');
    
    if (pendingMessages.length > 0) {
      console.log(`⚠️ Ditemukan ${pendingMessages.length} pesan dengan status pending`);
      
      // Cek apakah ada file sent yang sesuai
      const sentDir = path.join(__dirname, 'outbox', 'sent');
      if (fs.existsSync(sentDir)) {
        const sentFiles = fs.readdirSync(sentDir).filter(f => f.endsWith('.json'));
        
        for (const pendingMsg of pendingMessages) {
          const matchingSentFile = sentFiles.find(file => {
            try {
              const filePath = path.join(sentDir, file);
              const fileContent = fs.readFileSync(filePath, 'utf8');
              const sentData = JSON.parse(fileContent);
              
              return sentData.timestampMs === pendingMsg.timestampMs &&
                     (sentData.targetNumber === pendingMsg.targetNumber || 
                      sentData.originalNumber === pendingMsg.originalNumber);
            } catch (e) {
              return false;
            }
          });
          
          if (matchingSentFile) {
            console.log(`🔧 Auto-fixing pending status untuk: ${pendingMsg.targetNumber || pendingMsg.originalNumber}`);
            await fixSpecificNumber(
              pendingMsg.targetNumber || pendingMsg.originalNumber,
              pendingMsg.timestampMs
            );
          }
        }
      }
    } else {
      console.log('✅ Tidak ada pesan pending');
    }
    
  } catch (error) {
    console.error('❌ Error checking pending status:', error);
  }
}

// Export functions
module.exports = {
  fixPendingStatus,
  fixSpecificNumber,
  monitorStatusUpdates,
  checkPendingInHistory
};

// Jika file dijalankan langsung
if (require.main === module) {
  console.log('🚀 Menjalankan perbaikan status pending...');
  
  const args = process.argv.slice(2);
  
  if (args.length >= 2) {
    // Mode perbaikan nomor spesifik
    const phoneNumber = args[0];
    const timestampMs = parseInt(args[1]);
    
    fixSpecificNumber(phoneNumber, timestampMs)
      .then(success => {
        if (success) {
          console.log('✅ Perbaikan spesifik berhasil');
        } else {
          console.log('❌ Perbaikan spesifik gagal');
        }
        process.exit(success ? 0 : 1);
      })
      .catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
      });
      
  } else if (args[0] === 'monitor') {
    // Mode monitoring
    monitorStatusUpdates();
    checkPendingInHistory().catch(console.error);
    
    // Keep running
    console.log('🔄 Monitoring mode aktif. Tekan Ctrl+C untuk berhenti.');
    process.on('SIGINT', () => {
      console.log('\n👋 Monitoring dihentikan');
      process.exit(0);
    });
    
  } else {
    // Mode perbaikan semua
    fixPendingStatus()
      .then(() => {
        console.log('✅ Perbaikan selesai');
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
      });
  }
}
