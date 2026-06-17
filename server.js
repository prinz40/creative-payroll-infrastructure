import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'creativepay-secret-key-change-this';

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./database.db');

// Create users table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  phone TEXT,
  provider TEXT,
  country TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Routes
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'CreativePay API is running' });
});

// REGISTER ENDPOINT - This is what was missing
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone, provider, country } = req.body;
    
    if (!name ||!email ||!password) {
      return res.status(400).json({ error: 'Name, email and password required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      `INSERT INTO users (name, email, password, phone, provider, country) VALUES (?,?,?,?,?,?)`,
      [name, email, hashedPassword, phone, provider, country],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Email already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }
        
        const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET);
        res.json({ 
          message: 'Account created successfully',
          token,
          user: { id: this.lastID, name, email }
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// LOGIN ENDPOINT
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  db.get(`SELECT * FROM users WHERE email =?`, [email], async (err, user) => {
    if (err ||!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ 
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});