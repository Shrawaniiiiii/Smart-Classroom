const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const session = require('express-session');
const multer = require('multer'); // For handling file uploads
const cloudinary = require('cloudinary').v2; // For Cloudinary integration
const fs = require('fs'); // For file system operations
const app = express();
const port = 3000;

// Database Connection
const db = mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '', // Replace with your MySQL password
    database: 'stud_profile' // Replace with your database name
});

db.connect(err => {
    if (err) {
        console.error('❌ Database connection failed: ' + err.stack);
        return;
    }
    console.log('✅ Connected to MySQL database');
});

// Cloudinary Configuration
cloudinary.config({
    cloud_name: 'dlnqhdxfj', // Replace with your Cloudinary cloud name
    api_key: '281576885953584',      // Replace with your Cloudinary API key
    api_secret: 'da91U0IofxCymRHl0zmY6jUEK7c' // Replace with your Cloudinary API secret
});

// Middleware
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (HTML, CSS, JS, images)
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.json()); // Parse JSON bodies
app.use(session({
    secret: 'da91U0IofxCymRHl0zmY6jUEK7c', // Replace with a strong secret key
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

//multer configuration for file uploading
const upload = multer({ dest: 'uploads/' }); // Temporary storage for uploaded files

// Login Route
app.post('/login', (req, res) => {
    const { studentId, password } = req.body;

    const query = 'SELECT * FROM students WHERE student_id = ? AND password = ?';
    db.query(query, [studentId, password], (err, results) => {
        if (err) {
            console.error('❌ Database query error: ' + err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (results.length > 0) {
            req.session.student = results[0]; // Store student details in session
            res.json({ success: true, redirect: '/home.html' }); // Send success response
        } else {
            res.status(401).json({ success: false, message: 'Incorrect Student ID or Password' }); // Send error response
        }
    });
});

// Route to Fetch Student Data
app.get('/student-data', (req, res) => {
    if (!req.session.student) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const studentId = req.session.student.student_id; // Get student ID from session
    const query = 'SELECT * FROM students WHERE student_id = ?';
    db.query(query, [studentId], (err, results) => {
        if (err) {
            console.error('❌ Database query error: ' + err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (results.length > 0) {
            res.json({ success: true, student: results[0] }); // Send student data
        } else {
            res.status(404).json({ success: false, message: 'Student not found' });
        }
    });
});


//upload-photo route
app.post('/upload-photo', upload.single('photo'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    if (!req.session.student) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        // Upload the file to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'students' // Optional: Organize images in a folder
        });

        // Update the student's profile image in the database
        const studentId = req.session.student.student_id;
        const query = 'UPDATE students SET profile_image = ? WHERE student_id = ?';
        db.query(query, [result.secure_url, studentId], (err, results) => {
            if (err) {
                console.error('❌ Database query error: ' + err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }

            // Delete the temporary file after upload
            fs.unlinkSync(req.file.path);

            res.json({ success: true, imageUrl: result.secure_url });
        });
    } catch (error) {
        console.error('❌ Cloudinary upload error: ' + error);
        res.status(500).json({ success: false, message: 'Error uploading image' });
    }
});

// Add this route to server.js (before app.listen)
app.post('/attendance/scan-qr', async (req, res) => {
    if (!req.session.student) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { scannedData } = req.body;
    const loggedInStudentId = req.session.student.student_id;

    // Extract student ID from QR code (assuming format is "Student ID:STU101")
    const qrStudentId = scannedData.split(':')[1]?.trim();
    
    if (!qrStudentId) {
        return res.status(400).json({ success: false, message: 'Invalid QR code format' });
    }

    // Check if scanned ID matches logged in student
    if (qrStudentId !== loggedInStudentId) {
        return res.status(403).json({ success: false, message: 'QR code does not match logged in student' });
    }

    // Check if attendance already marked today
    const checkQuery = 'SELECT * FROM attendance WHERE student_id = ? AND date = CURDATE()';
    db.query(checkQuery, [loggedInStudentId], (err, results) => {
        if (err) {
            console.error('❌ Database query error: ' + err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (results.length > 0) {
            return res.json({ success: true, message: 'Attendance already marked today' });
        }

        // Mark attendance
        const insertQuery = 'INSERT INTO attendance (student_id, date, status) VALUES (?, CURDATE(), "Present")';
        db.query(insertQuery, [loggedInStudentId], (err, results) => {
            if (err) {
                console.error('❌ Database query error: ' + err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }

            res.json({ success: true, message: 'Attendance marked successfully' });
        });
    });
});

// Add this function to mark absent students after 5 minutes
function markAbsentStudents() {
    // Get current time minus 30 minutes
    const fiveMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const formattedTime = fiveMinutesAgo.toISOString().slice(0, 19).replace('T', ' ');
    
    // Mark students as absent who haven't scanned today
    const query = `
        INSERT INTO attendance (student_id, date, status)
        SELECT student_id, CURDATE(), 'Absent'
        FROM students
        WHERE student_id NOT IN (
            SELECT student_id FROM attendance WHERE date = CURDATE()
        )
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('❌ Error marking absent students:', err);
        } else {
            console.log(`✅ Marked ${results.affectedRows} students as absent`);
        }
    });
}

// 📊 Dashboard Attendance Summary & Recent Records
app.get('/student-dashboard', (req, res) => {
    if (!req.session.student) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const studentId = req.session.student.student_id;

    const query = `
        SELECT date, status 
        FROM attendance 
        WHERE student_id = ? 
        ORDER BY date DESC 
        LIMIT 7
    `;

    db.query(query, [studentId], (err, results) => {
        if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        const total = results.length;
        const present = results.filter(r => r.status === 'Present').length;
        const absent = total - present;

        res.json({
            success: true,
            presentPercent: total ? Math.round((present / total) * 100) : 0,
            absentPercent: total ? Math.round((absent / total) * 100) : 0,
            recent: results
        });
    });
});



// 📅 Dynamic Today's Schedule
app.get('/today-schedule', (req, res) => {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const today = days[new Date().getDay()];

    const query = 'SELECT * FROM timetable WHERE day = ?';
    db.query(query, [today], (err, results) => {
        if (err || results.length === 0) {
            return res.status(500).json({ success: false, message: 'Error loading schedule' });
        }
        res.json({ success: true, schedule: results[0] });
    });
});


// 📍 Route to get next available student ID
app.get('/last-student-id', (req, res) => {
    const query = 'SELECT student_id FROM students ORDER BY student_id DESC LIMIT 1';
  
    db.query(query, (err, result) => {
      if (err) return res.status(500).json({ success: false });
  
      if (result.length === 0) return res.json({ nextId: 'STU101' });
  
      const lastId = result[0].student_id; // e.g., STU105
      const lastNum = parseInt(lastId.replace('STU', ''));
      const nextId = 'STU' + (lastNum + 1);
  
      res.json({ nextId });
    });
  });
  


// Run the absent marking function every 30 minutes
setInterval(markAbsentStudents, 30 * 60 * 1000);

// Default Route (Redirect to Login Page)
app.get('/', (req, res) => {
    res.redirect('/login.html'); // Redirect to login page
});

// Start the Server
app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:3000`);
});