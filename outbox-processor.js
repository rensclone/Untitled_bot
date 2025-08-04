// outbox-processor.js - DIPERBAIKI: Update status history yang konsisten

const fs = require('fs');
const path = require('path');
const { saveMessageToHistory } = require('./message-history');
const { updateMessageStatus, formatWhatsAppNumber } = require('./message-sender');

function setupOutboxProcessor(sock) {
  console.log('🔄 Memulai pemrosesan pesan dari outbox...');
  
  const outboxDir = path.join(__dirname, 'outbox');
  const sentDir = path.join(__dirname, 'outbox', 'sent');
  const errorDir = path.join(__dirname, 'outbox', 'error');
  
  try {
    [outboxDir, sentDir, errorDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Direktori ${dir} berhasil dibuat`);
      }
    });
  } catch (error) {
    console.error('❌ Error membuat direktori:', error);
    throw error;
  }
  
  // Set untuk melacak file yang sedang diproses
  const processingFiles = new Set();
  // Set untuk mencegah duplikasi history berdasarkan unique key
  const processedMessages = new Set();
  
  // Fungsi untuk membuat unique key dari message data
  const createMessageKey = (messageData) => {
    const phoneNumber = messageData.originalNumber || messageData.targetNumber;
    const timestamp = messageData.timestampMs || messageData.timestamp;
    const messageHash = messageData.message.substring(0, 50); // 50 karakter pertama pesan
    return `${phoneNumber}_${timestamp}_${Buffer.from(messageHash).toString('base64').substring(0, 10)}`;
  };
  
  // FUNGSI BARU: Update history status secara langsung
  const updateHistoryStatus = async (messageData, newStatus, retryCount = 0) => {
    const maxRetries = 3;
    try {
      console.log(`📝 Mengupdate history status: ${messageData.targetNumber} -> ${newStatus}`);
      
      // Baca file history
      const historyDbPath = path.join(__dirname, 'message-history.json');
      
      if (!fs.existsSync(historyDbPath)) {
        console.error('❌ File history tidak ditemukan');
        return false;
      }
      
      const db = JSON.parse(fs.readFileSync(historyDbPath, 'utf8'));
      
      // Cari pesan berdasarkan nomor target dan timestamp yang mirip
      const targetPhoneNumber = messageData.originalNumber || messageData.targetNumber.replace('@s.whatsapp.net', '');
      const messageTimestamp = new Date(messageData.timestamp || messageData.timestampMs);
      
      console.log(`🔍 Mencari history untuk: ${targetPhoneNumber}, timestamp: ${messageTimestamp.toISOString()}`);
      
      // Cari dengan toleransi waktu 10 detik
      const matchingMessageIndex = db.messages.findIndex(msg => {
        const msgPhoneNumber = (msg.targetNumber || '').replace('@s.whatsapp.net', '');
        const msgTimestamp = new Date(msg.sentAt || msg.timestamp);
        const timeDiff = Math.abs(messageTimestamp - msgTimestamp);
        
        // Match berdasarkan nomor dan waktu dengan toleransi
        const phoneMatch = msgPhoneNumber.includes(targetPhoneNumber.replace(/\D/g, '')) || 
                          targetPhoneNumber.replace(/\D/g, '').includes(msgPhoneNumber.replace(/\D/g, ''));
        const timeMatch = timeDiff < 10000; // 10 detik toleransi
        const messageMatch = msg.message === messageData.message;
        
        console.log(`📊 Checking match: phone=${phoneMatch}, time=${timeMatch}, message=${messageMatch}, timeDiff=${timeDiff}ms`);
        
        return phoneMatch && timeMatch && messageMatch;
      });
      
      if (matchingMessageIndex === -1) {
        console.error(`❌ Tidak menemukan pesan di history untuk update status`);
        return false;
      }
      
      // Update status
      const oldStatus = db.messages[matchingMessageIndex].status;
      db.messages[matchingMessageIndex].status = newStatus;
      db.messages[matchingMessageIndex].updatedAt = new Date().toISOString();
      db.messages[matchingMessageIndex].statusUpdatedBy = 'outbox-processor';
      
      // Jika status berhasil dikirim, tambahkan info tambahan
      if (newStatus === 'sent') {
        db.messages[matchingMessageIndex].sentAt = messageData.sentAt || new Date().toISOString();
        db.messages[matchingMessageIndex].actualTarget = messageData.actualTarget || messageData.targetNumber;
      }
      
      // Simpan kembali ke file
      fs.writeFileSync(historyDbPath, JSON.stringify(db, null, 2));
      
      console.log(`✅ History status berhasil diupdate: ${oldStatus} -> ${newStatus}`);
      return true;
      
    } catch (error) {
      console.error(`❌ Error updateHistoryStatus (attempt ${retryCount + 1}):`, error);
      
      // Retry mechanism
      if (retryCount < maxRetries) {
        console.log(`🔄 Retrying history update in 1 second... (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await updateHistoryStatus(messageData, newStatus, retryCount + 1);
      }
      
      console.error(`💥 FINAL FAILURE: History update failed after ${maxRetries} attempts`);
      return false;
    }
  };
  
  // Fungsi untuk update status dengan validasi yang ketat dan retry mechanism
  const safeUpdateMessageStatus = async (messageData, success, errorMsg, sentAt, retryCount = 0) => {
    const maxRetries = 3;
    try {
      // Validasi parameter wajib
      if (!messageData.targetNumber) {
        console.error('❌ targetNumber tidak ada untuk update status');
        return false;
      }
      
      if (!messageData.timestampMs) {
        console.error('❌ timestampMs tidak ada untuk update status');
        return false;
      }
      
      console.log(`📊 Updating status (attempt ${retryCount + 1}): ${messageData.targetNumber} | ${messageData.timestampMs} | Success: ${success}`);
      
      // Panggil updateMessageStatus dengan parameter yang jelas
      const result = await updateMessageStatus(
        messageData.targetNumber, 
        messageData.timestampMs, 
        success, 
        errorMsg, 
        sentAt
      );
      
      console.log(`✅ Status update result:`, result);
      
      // Verifikasi status update berhasil
      if (result && (result.success !== false)) {
        console.log(`✅ Status berhasil diupdate: ${messageData.targetNumber}`);
        return true;
      } else {
        throw new Error('Status update returned false or null result');
      }
      
    } catch (statusError) {
      console.error(`❌ Error dalam safeUpdateMessageStatus (attempt ${retryCount + 1}):`, {
        error: statusError.message,
        stack: statusError.stack,
        targetNumber: messageData.targetNumber,
        timestampMs: messageData.timestampMs,
        success: success
      });
      
      // Retry mechanism
      if (retryCount < maxRetries) {
        console.log(`🔄 Retrying status update in 2 seconds... (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await safeUpdateMessageStatus(messageData, success, errorMsg, sentAt, retryCount + 1);
      }
      
      console.error(`💥 FINAL FAILURE: Status update failed after ${maxRetries} attempts`);
      return false;
    }
  };
  
  const checkOutbox = async () => {
    try {
      if (!fs.existsSync(outboxDir)) {
        console.log('⚠️ Direktori outbox tidak ditemukan, membuat ulang...');
        fs.mkdirSync(outboxDir, { recursive: true });
        return;
      }
      
      const files = fs.readdirSync(outboxDir);
      const messageFiles = files.filter(file => 
        file.endsWith('.json') && 
        fs.statSync(path.join(outboxDir, file)).isFile() &&
        !file.startsWith('.') &&
        !processingFiles.has(file)
      );
      
      if (messageFiles.length > 0) {
        console.log(`📨 Menemukan ${messageFiles.length} pesan di outbox`);
        
        // Urutkan berdasarkan timestamp
        messageFiles.sort((a, b) => {
          const timestampA = a.split('_')[1] || '0';
          const timestampB = b.split('_')[1] || '0';
          return parseInt(timestampA) - parseInt(timestampB);
        });
      }
      
      for (const file of messageFiles) {
        // Tandai file sedang diproses
        processingFiles.add(file);
        
        const filePath = path.join(outboxDir, file);
        let messageData = null;
        let messageSent = false;
        let uniqueKey = null;
        let statusUpdated = false;
        let historyUpdated = false;
        
        try {
          // Double check file masih ada
          if (!fs.existsSync(filePath)) {
            console.log(`⚠️ File ${file} sudah tidak ada, skip...`);
            continue;
          }
          
          const fileContent = fs.readFileSync(filePath, 'utf8');
          messageData = JSON.parse(fileContent);
          
          // Buat unique key untuk mencegah duplikasi
          uniqueKey = createMessageKey(messageData);
          
          // PERBAIKAN: Cek duplikasi sebelum memproses
          if (processedMessages.has(uniqueKey)) {
            console.log(`⚠️ Pesan duplikat terdeteksi, skip processing: ${uniqueKey}`);
            
            // Hapus file duplikat
            fs.unlinkSync(filePath);
            continue;
          }
          
          // Tandai sebagai sedang diproses
          processedMessages.add(uniqueKey);
          
          // Validasi data pesan
          if (!messageData.targetNumber || !messageData.message) {
            throw new Error('Format pesan tidak valid: targetNumber dan message harus diisi');
          }
          
          // PERBAIKAN: Pastikan timestampMs konsisten
          if (!messageData.timestampMs) {
            if (messageData.timestamp) {
              messageData.timestampMs = new Date(messageData.timestamp).getTime();
            } else {
              messageData.timestampMs = Date.now();
              messageData.timestamp = new Date(messageData.timestampMs).toISOString();
            }
            console.log(`🔧 TimestampMs dibuat: ${messageData.timestampMs} untuk ${messageData.targetNumber}`);
          }
          
          // Format nomor WhatsApp
          let jid = messageData.targetNumber;
          try {
            if (!jid.includes('@s.whatsapp.net')) {
              jid = formatWhatsAppNumber(messageData.originalNumber || messageData.targetNumber);
              console.log(`🔧 Nomor diformat: ${messageData.targetNumber} -> ${jid}`);
            }
          } catch (formatError) {
            throw new Error(`Format nomor tidak valid: ${formatError.message}`);
          }
          
          console.log(`📤 Mengirim pesan ke ${jid} (Key: ${uniqueKey})...`);
          console.log(`📝 Pesan: ${messageData.message.substring(0, 100)}${messageData.message.length > 100 ? '...' : ''}`);
          
          // Kirim pesan
          const sendPromise = sock.sendMessage(jid, { text: messageData.message });
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout mengirim pesan (20 detik)')), 20000)
          );
          
          const sendResult = await Promise.race([sendPromise, timeoutPromise]);
          messageSent = true;
          
          console.log(`✅ Pesan berhasil dikirim ke ${messageData.originalNumber || messageData.targetNumber}`);
          console.log(`📋 Send result:`, sendResult);
          
          // Update data pesan dengan status sent
          const sentAt = new Date().toISOString();
          messageData.status = 'sent';
          messageData.sentAt = sentAt;
          messageData.actualTarget = jid;
          messageData.processedAt = sentAt;
          messageData.uniqueKey = uniqueKey;
          messageData.sendResult = sendResult;
          
          // PERBAIKAN KRITIS: Update status database
          console.log(`📊 PRIORITAS: Mengupdate status database...`);
          statusUpdated = await safeUpdateMessageStatus(messageData, true, null, sentAt);
          
          // PERBAIKAN UTAMA: Update history status secara langsung
          console.log(`📝 PRIORITAS: Mengupdate history status...`);
          historyUpdated = await updateHistoryStatus(messageData, 'sent');
          
          if (!statusUpdated) {
            console.error(`💥 CRITICAL: GAGAL UPDATE STATUS DATABASE`);
            messageData.statusUpdateError = 'Failed to update database status';
          } else {
            console.log(`✅ SUKSES: Status database berhasil diupdate`);
          }
          
          if (!historyUpdated) {
            console.error(`💥 CRITICAL: GAGAL UPDATE HISTORY STATUS`);
            messageData.historyUpdateError = 'Failed to update history status';
          } else {
            console.log(`✅ SUKSES: History status berhasil diupdate`);
          }
          
          // Update messageData dengan status terbaru
          if (statusUpdated && historyUpdated) {
            messageData.databaseStatus = 'updated';
            messageData.historyStatus = 'updated';
            messageData.finalStatus = 'sent';
          } else if (statusUpdated) {
            messageData.databaseStatus = 'updated';
            messageData.historyStatus = 'failed';
            messageData.finalStatus = 'sent_but_history_error';
          } else if (historyUpdated) {
            messageData.databaseStatus = 'failed';
            messageData.historyStatus = 'updated';
            messageData.finalStatus = 'sent_but_db_error';
          } else {
            messageData.databaseStatus = 'failed';
            messageData.historyStatus = 'failed';
            messageData.finalStatus = 'sent_but_all_updates_failed';
          }
          
          console.log(`🎯 FINAL STATUS: ${messageData.finalStatus}`);
          
          // Pindahkan ke folder sent
          try {
            const sentFileName = (statusUpdated && historyUpdated) ? file : `partial_error_${file}`;
            const sentFilePath = path.join(sentDir, sentFileName);
            fs.writeFileSync(sentFilePath, JSON.stringify(messageData, null, 2));
            console.log(`📁 File dipindahkan ke sent: ${sentFileName}`);
          } catch (moveError) {
            console.error(`⚠️ Error memindahkan file:`, moveError);
          }
          
        } catch (error) {
          console.error(`❌ Error memproses ${file}:`, error.message);
          
          // Jika pesan sudah terkirim tapi ada error post-processing
          if (messageSent && messageData) {
            console.log(`⚠️ Pesan terkirim tapi ada error post-processing`);
            
            // Update status database untuk pesan yang terkirim
            const sentAt = new Date().toISOString();
            messageData.status = 'sent';
            messageData.sentAt = sentAt;
            messageData.postProcessingError = error.message;
            messageData.uniqueKey = uniqueKey;
            
            // Coba update status database
            try {
              statusUpdated = await safeUpdateMessageStatus(messageData, true, null, sentAt);
              if (statusUpdated) {
                console.log(`✅ Status recovery berhasil diupdate`);
              }
            } catch (statusError) {
              console.error(`❌ Error status recovery:`, statusError);
              statusUpdated = false;
            }
            
            // Coba update history status
            try {
              historyUpdated = await updateHistoryStatus(messageData, 'sent');
              if (historyUpdated) {
                console.log(`✅ History recovery berhasil diupdate`);
              }
            } catch (historyError) {
              console.error(`❌ Error history recovery:`, historyError);
              historyUpdated = false;
            }
            
            // Pindahkan ke sent dengan warning
            try {
              const sentFilePath = path.join(sentDir, `warning_${file}`);
              fs.writeFileSync(sentFilePath, JSON.stringify(messageData, null, 2));
            } catch (moveError) {
              console.error(`❌ Error move to sent:`, moveError);
            }
            
          } else {
            // Pesan tidak terkirim
            console.log(`❌ Pesan TIDAK terkirim: ${error.message}`);
            
            if (messageData && messageData.targetNumber && messageData.timestampMs) {
              // Update status error di database
              await safeUpdateMessageStatus(
                messageData, 
                false, 
                error.message
              );
              
              // Update history status ke error
              await updateHistoryStatus(messageData, 'error');
            }
            
            if (messageData) {
              messageData.status = 'error';
              messageData.error = error.message;
              messageData.lastAttempt = new Date().toISOString();
              messageData.uniqueKey = uniqueKey;
              
              // Pindahkan ke error folder
              try {
                const errorFilePath = path.join(errorDir, file);
                fs.writeFileSync(errorFilePath, JSON.stringify(messageData, null, 2));
              } catch (moveError) {
                console.error(`❌ Error move to error:`, moveError);
              }
            }
          }
        } finally {
          // Hapus file asli
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`🗑️ File asli dihapus: ${file}`);
            }
          } catch (deleteError) {
            console.error(`❌ Error hapus file:`, deleteError);
          }
          
          // Remove from processing set
          processingFiles.delete(file);
        }
        
        // Delay antar pesan
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('❌ Error checkOutbox:', error);
    }
  };
  
  // Setup intervals
  const intervalId = setInterval(checkOutbox, 3000); // Lebih lambat untuk stabilitas
  
  setTimeout(() => {
    console.log('🚀 Memulai pengecekan outbox...');
    checkOutbox().catch(console.error);
  }, 1000);
  
  // Cleanup processed messages setiap 5 menit untuk mencegah memory leak
  const cleanupInterval = setInterval(() => {
    const currentTime = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 menit
    
    // Tidak perlu cleanup processedMessages karena ini mencegah duplikasi
    // Tapi kita bisa log status
    console.log(`🧹 Processed messages count: ${processedMessages.size}, Processing files: ${processingFiles.size}`);
  }, 5 * 60 * 1000);
  
  return {
    stop: () => {
      clearInterval(intervalId);
      clearInterval(cleanupInterval);
      console.log('🛑 Outbox processor dihentikan');
    },
    getProcessingFiles: () => Array.from(processingFiles),
    forceCheck: () => {
      console.log('🔄 Force check outbox');
      return checkOutbox().catch(console.error);
    },
    getStats: () => ({
      processingCount: processingFiles.size,
      processedCount: processedMessages.size,
      processingFiles: Array.from(processingFiles)
    }),
    clearProcessedMessages: () => {
      processedMessages.clear();
      console.log('🧹 Processed messages cache cleared');
    }
  };
}

module.exports = { setupOutboxProcessor };