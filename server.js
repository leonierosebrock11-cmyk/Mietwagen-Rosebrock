const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// SQLite Datenbankverbindung
const dbFile = path.join(__dirname, 'rosebrock.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Fehler beim Verbinden mit der SQLite-Datenbank:', err.message);
    } else {
        console.log('Mit SQLite-Datenbank verbunden.');
        initDatabase();
    }
});

// Hilfsfunktion für zufällige Passwörter
function generatePassword(length = 8) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length);
}

// Tabellen initialisieren & Beispieldaten einfügen
function initDatabase() {
    db.serialize(() => {
        // Fahrer-Tabelle mit Login-Daten und Adresse
        db.run(`CREATE TABLE IF NOT EXISTS drivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            username TEXT,
            password TEXT,
            address TEXT,
            vehicleType TEXT,
            statusText TEXT,
            breakHours REAL,
            currentLocation TEXT
        )`);

        // Kinder-Tabelle
        db.run(`CREATE TABLE IF NOT EXISTS kids (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            schoolName TEXT,
            isAbsent INTEGER DEFAULT 0,
            location TEXT
        )`);

        // Prüfen, ob Fahrer existieren, sonst echte Daten mit Zufallspasswörtern anlegen
        db.get("SELECT COUNT(*) as count FROM drivers", (err, row) => {
            if (row && row.count === 0) {
                const pass1 = generatePassword(8);
                const pass2 = generatePassword(8);
                const pass3 = generatePassword(8);

                db.run(`INSERT INTO drivers (name, username, password, address, vehicleType, statusText, breakHours, currentLocation) VALUES 
                    ('Hans Rosebrock', 'hans', ?, 'Mühlenstraße 12, 29221 Celle', 'Kleinbus', 'Frei', 2.0, 'Celle'),
                    ('Sabine Meier', 'sabine', ?, 'Hauptstraße 45, 29336 Nienhagen', 'Rollstuhlgerecht', 'Pause', 1.5, 'Nienhagen'),
                    ('Michael Klein', 'michael', ?, 'Dammfeld 8, 29342 Wienhausen', 'PKW', 'Im Dienst', 0.5, 'Wienhausen')`,
                    [pass1, pass2, pass3],
                    () => {
                        console.log('--- GENERIERTE FAHRER-PASSWÖRTER ---');
                        console.log(`Benutzer 'hans': ${pass1}`);
                        console.log(`Benutzer 'sabine': ${pass2}`);
                        console.log(`Benutzer 'michael': ${pass3}`);
                        console.log('------------------------------------');
                    }
                );
            }
        });

        // Prüfen, ob Kinder existieren, sonst Beispieldaten einfügen
        db.get("SELECT COUNT(*) as count FROM kids", (err, row) => {
            if (row && row.count === 0) {
                db.run(`INSERT INTO kids (name, schoolName, isAbsent, location) VALUES 
                    ('Timmy Müller', 'Grundschule Altenhagen', 0, 'Celle'),
                    ('Sarah Connor', 'Oberschule Lachendorf', 0, 'Lachendorf'),
                    ('Leon Schmidt', 'IGS Celle', 0, 'Celle')`);
            }
        });
    });
}

// API: Alle Daten für Admin laden
app.get('/api/admin/data', (req, res) => {
    db.all("SELECT * FROM drivers", [], (err, drivers) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all("SELECT * FROM kids", [], (err, kids) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ drivers, kids });
        });
    });
});

// API: Alle Kinder für Eltern/Schule laden
app.get('/api/kids', (req, res) => {
    db.all("SELECT * FROM kids", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Fahrer-Login (Prüfung von Benutzername & Passwort)
app.post('/api/driver/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM drivers WHERE username = ? AND password = ?", [username, password], (err, driver) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!driver) {
            return res.status(401).json({ success: false, error: 'Ungültige Anmeldedaten' });
        }
        res.json({ success: true, driver });
    });
});

// API: Neuen Fahrer dynamisch anlegen (Generiert automatisch ein Passwort)
app.post('/api/admin/add-driver', (req, res) => {
    const { name, username, address, vehicleType, currentLocation } = req.body;
    const password = generatePassword(8);

    db.run(
        `INSERT INTO drivers (name, username, password, address, vehicleType, statusText, breakHours, currentLocation) VALUES (?, ?, ?, ?, ?, 'Frei', 2.0, ?)`,
        [name, username, password, address, vehicleType, currentLocation],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, driverId: this.lastID, generatedPassword: password });
        }
    );
});

// API: Krankmeldung durch Eltern
app.post('/api/parent/report-absence', (req, res) => {
    const { kidId } = req.body;
    db.run("UPDATE kids SET isAbsent = 1 WHERE id = ?", [kidId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// API: Fahrer-Status aktualisieren
app.post('/api/admin/update-driver-status', (req, res) => {
    const { driverId, statusText, breakHours } = req.body;
    db.run("UPDATE drivers SET statusText = ?, breakHours = ? WHERE id = ?", [statusText, breakHours, driverId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// API: Smart Matching für Ersatzfahrer
app.post('/api/admin/suggest-driver-replacement', (req, res) => {
    const { driverId } = req.body;
    
    db.get("SELECT * FROM drivers WHERE id = ?", [driverId], (err, sickDriver) => {
        if (err || !sickDriver) return res.status(404).json({ success: false, error: 'Fahrer nicht gefunden' });

        db.all("SELECT * FROM drivers WHERE id != ? AND (statusText = 'Frei' OR statusText = 'Pause')", [driverId], (err, availableDrivers) => {
            if (err) return res.status(500).json({ error: err.message });

            let suggestions = availableDrivers.map(d => {
                let score = 0;
                let reasons = [];

                if (d.currentLocation === sickDriver.currentLocation) {
                    score += 50;
                    reasons.push('Gleicher Standort (' + d.currentLocation + ')');
                } else {
                    score += 10;
                    reasons.push('Anderer Standort (' + d.currentLocation + ')');
                }

                if (d.vehicleType === sickDriver.vehicleType) {
                    score += 30;
                    reasons.push('Passender Fahrzeugtyp (' + d.vehicleType + ')');
                }

                if (d.breakHours >= 1.0) {
                    score += 20;
                    reasons.push('Genügend Pause (' + d.breakHours + 'h)');
                }

                return { driver: d, score, reasons };
            });

            suggestions.sort((a, b) => b.score - a.score);

            res.json({
                success: true,
                sickDriver,
                affectedKidsCount: 2,
                suggestions
            });
        });
    });
});

// Server starten
app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});