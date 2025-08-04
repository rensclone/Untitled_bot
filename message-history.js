// message-history.js - Versi yang diperbaiki untuk mencegah duplikasi

const fs = require('fs');
const path = require('path');

// Path ke file database history
const historyDbPath = path.join(__dirname, 'message-history.json');

// Inisialisasi database jika belum ada
if (!fs.existsSync(historyDbPath)) {
    fs.writeFileSync(historyDbPath, JSON.stringify({
        messages: []
    }, null, 2));
}

// Set untuk melacak pesan yang sudah disimpan (mencegah duplikasi)
const savedMessages = new Set();

// Fungsi untuk membuat ID unik dari data pesan
function createMessageId(messageData) {
    const key = `${messageData.targetNumber}_${messageData.message}_${messageData.timestamp || Date.now()}`;
    return Buffer.from(key).toString('base64').substring(0, 20);
}

// Fungsi untuk menyimpan pesan ke history dengan pencegahan duplikasi
function saveMessageToHistory(messageData) {
    return new Promise((resolve, reject) => {
        try {
            // Buat ID unik untuk pesan
            const messageId = createMessageId(messageData);
            
            // Cek apakah pesan sudah pernah disimpan
            if (savedMessages.has(messageId)) {
                console.log(`⚠️ Pesan dengan ID ${messageId} sudah ada, skip duplikasi`);
                return resolve(true);
            }
            
            const db = JSON.parse(fs.readFileSync(historyDbPath, 'utf8'));
            
            // Double check di database untuk memastikan tidak ada duplikasi
            const existingMessage = db.messages.find(msg => 
                msg.targetNumber === messageData.targetNumber &&
                msg.message === messageData.message &&
                Math.abs(new Date(msg.sentAt || msg.timestamp) - new Date(messageData.sentAt || messageData.timestamp)) < 5000 // 5 detik toleransi
            );
            
            if (existingMessage) {
                console.log(`⚠️ Pesan duplikat ditemukan di database, skip...`);
                savedMessages.add(messageId);
                return resolve(true);
            }
            
            // Tambahkan pesan ke array messages dengan ID unik
            const newMessage = {
                id: messageId,
                targetNumber: messageData.targetNumber,
                message: messageData.message,
                status: messageData.status || 'sent',
                sentAt: messageData.sentAt || new Date().toISOString(),
                template: messageData.template || null,
                actualTarget: messageData.actualTarget || null,
                error: messageData.error || null,
                postProcessingError: messageData.postProcessingError || null
            };
            
            db.messages.push(newMessage);
            
            // Tambahkan ke set untuk mencegah duplikasi di masa depan
            savedMessages.add(messageId);
            
            // Simpan kembali ke file
            fs.writeFileSync(historyDbPath, JSON.stringify(db, null, 2));
            
            console.log(`💾 History berhasil disimpan: ${messageData.targetNumber} - ${messageData.status}`);
            resolve(true);
        } catch (error) {
            console.error('Error menyimpan pesan ke history:', error);
            reject(error);
        }
    });
}

// Fungsi untuk mendapatkan semua history pesan
function getAllMessageHistory() {
    try {
        const db = JSON.parse(fs.readFileSync(historyDbPath, 'utf8'));
        return db.messages;
    } catch (error) {
        console.error('Error membaca history pesan:', error);
        return [];
    }
}

// Fungsi untuk mendapatkan history pesan berdasarkan filter
function getFilteredMessageHistory(filter = {}) {
    try {
        const db = JSON.parse(fs.readFileSync(historyDbPath, 'utf8'));
        let messages = db.messages;

        // Filter berdasarkan status
        if (filter.status) {
            messages = messages.filter(msg => msg.status === filter.status);
        }

        // Filter berdasarkan tanggal
        if (filter.startDate && filter.endDate) {
            messages = messages.filter(msg => {
                const sentDate = new Date(msg.sentAt);
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

        return messages;
    } catch (error) {
        console.error('Error membaca history pesan dengan filter:', error);
        return [];
    }
}

// Fungsi untuk membersihkan duplikasi yang sudah ada
function cleanDuplicateHistory() {
    try {
        const db = JSON.parse(fs.readFileSync(historyDbPath, 'utf8'));
        const seen = new Map();
        const cleanedMessages = [];
        
        // Urutkan berdasarkan timestamp, ambil yang terbaru
        db.messages.sort((a, b) => new Date(b.sentAt || b.timestamp) - new Date(a.sentAt || a.timestamp));
        
        for (const message of db.messages) {
            const key = `${message.targetNumber}_${message.message}`;
            
            if (!seen.has(key)) {
                seen.set(key, true);
                cleanedMessages.push(message);
            }
        }
        
        console.log(`🧹 Membersihkan duplikasi: ${db.messages.length} -> ${cleanedMessages.length} pesan`);
        
        // Simpan hasil yang sudah dibersihkan
        db.messages = cleanedMessages;
        fs.writeFileSync(historyDbPath, JSON.stringify(db, null, 2));
        
        return cleanedMessages.length;
    } catch (error) {
        console.error('Error membersihkan duplikasi:', error);
        return 0;
    }
}

// Load existing messages ke memory saat startup untuk mencegah duplikasi
function initializeMessageTracking() {
    try {
        const db = JSON.parse(fs.readFileSync(historyDbPath, 'utf8'));
        db.messages.forEach(msg => {
            if (msg.id) {
                savedMessages.add(msg.id);
            } else {
                // Untuk pesan lama yang belum punya ID
                const messageId = createMessageId(msg);
                savedMessages.add(messageId);
            }
        });
        console.log(`📋 Loaded ${savedMessages.size} existing messages untuk tracking duplikasi`);
    } catch (error) {
        console.error('Error initializing message tracking:', error);
    }
}

// Inisialisasi tracking saat module dimuat
initializeMessageTracking();

module.exports = {
    saveMessageToHistory,
    getAllMessageHistory,
    getFilteredMessageHistory,
    cleanDuplicateHistory,
    initializeMessageTracking
};