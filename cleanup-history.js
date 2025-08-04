// cleanup-history.js - Script untuk membersihkan history duplikat yang sudah ada

const { cleanDuplicateHistory, initializeMessageTracking } = require('./message-history');

async function cleanupExistingHistory() {
    console.log('🧹 Memulai pembersihan history duplikat...');
    
    try {
        // Bersihkan duplikasi
        const cleanedCount = cleanDuplicateHistory();
        
        if (cleanedCount > 0) {
            console.log(`✅ Berhasil membersihkan history. Tersisa ${cleanedCount} pesan unik.`);
        } else {
            console.log('ℹ️ Tidak ada duplikasi yang ditemukan atau terjadi error.');
        }
        
        // Reinitialize tracking
        initializeMessageTracking();
        
        console.log('🎉 Pembersihan selesai!');
        
    } catch (error) {
        console.error('❌ Error saat membersihkan history:', error);
    }
}

// Jalankan jika file ini dieksekusi langsung
if (require.main === module) {
    cleanupExistingHistory().then(() => {
        console.log('👋 Selesai! Anda bisa restart bot sekarang.');
        process.exit(0);
    }).catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
}

module.exports = { cleanupExistingHistory };