import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';

const app = express();

// Configure CORS for production
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://binah-full.vercel.app', 'https://*.vercel.app']
    : '*',
  credentials: true
}));

app.use(express.json());

// Database connection for production
let pool;
if (process.env.DB_HOST) {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    connectionLimit: 10,
    acquireTimeout: 60000,
    timeout: 60000
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Initialize database endpoint
app.post('/api/init', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ 
      success: false, 
      error: 'Database not configured for production' 
    });
  }

  try {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS topics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        keywords TEXT,
        preview TEXT,
        content TEXT,
        author VARCHAR(100),
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        views INT DEFAULT 0,
        helpful INT DEFAULT 0
      )
    `;
    
    await pool.query(createTableSQL);
    res.json({ success: true, message: 'Database initialized successfully' });
  } catch (error) {
    console.error('Database init error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all topics with search and filtering
app.get('/api/topics', async (req, res) => {
  try {
    if (!pool) {
      // Return empty array if no database in production
      return res.json([]);
    }

    let sql = 'SELECT * FROM topics';
    let params = [];
    
    const { search, category, limit } = req.query;
    
    if (search || (category && category !== 'all')) {
      sql += ' WHERE ';
      const conditions = [];
      
      if (search) {
        conditions.push('(title LIKE ? OR keywords LIKE ? OR content LIKE ?)');
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      if (category && category !== 'all') {
        conditions.push('category = ?');
        params.push(category);
      }
      
      sql += conditions.join(' AND ');
    }
    
    sql += ' ORDER BY created_date DESC';
    
    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit));
    }
    
    const [rows] = await pool.query(sql, params);
    
    const topics = rows.map(topic => ({
      ...topic,
      keywords: topic.keywords ? topic.keywords.split(',').map(k => k.trim()) : [],
      date: topic.created_date ? topic.created_date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    }));
    
    res.json(topics);
  } catch (error) {
    console.error('Get topics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single topic by ID
app.get('/api/topics/:id', async (req, res) => {
  try {
    if (!pool) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const [rows] = await pool.query('SELECT * FROM topics WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }
    
    const topic = {
      ...rows[0],
      keywords: rows[0].keywords ? rows[0].keywords.split(',').map(k => k.trim()) : [],
      date: rows[0].created_date ? rows[0].created_date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    };
    
    res.json(topic);
  } catch (error) {
    console.error('Get topic error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new topic
app.post('/api/topics', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const { title, category, keywords, content, author } = req.body;
    
    const keywordStr = Array.isArray(keywords) ? keywords.join(', ') : keywords || '';
    const preview = content ? content.replace(/<[^>]*>/g, '').substring(0, 200) + '...' : '';
    
    const [result] = await pool.query(
      'INSERT INTO topics (title, category, keywords, preview, content, author) VALUES (?, ?, ?, ?, ?, ?)',
      [title, category, keywordStr, preview, content, author || 'Usuário']
    );
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('Create topic error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update topic
app.put('/api/topics/:id', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: 'Database not available' });
    }

    const { id } = req.params;
    const updates = req.body;
    
    if (updates.incrementView) {
      await pool.query('UPDATE topics SET views = views + 1 WHERE id = ?', [id]);
    } else if (updates.incrementHelpful) {
      await pool.query('UPDATE topics SET helpful = helpful + 1 WHERE id = ?', [id]);
    } else {
      const { title, category, keywords, content, author } = updates;
      const keywordStr = Array.isArray(keywords) ? keywords.join(', ') : keywords || '';
      const preview = content ? content.replace(/<[^>]*>/g, '').substring(0, 200) + '...' : '';
      
      await pool.query(
        'UPDATE topics SET title = ?, category = ?, keywords = ?, preview = ?, content = ?, author = ? WHERE id = ?',
        [title, category, keywordStr, preview, content, author || 'Usuário', id]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update topic error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete topic
app.delete('/api/topics/:id', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: 'Database not available' });
    }

    await pool.query('DELETE FROM topics WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete topic error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get category stats
app.get('/api/stats/categories', async (req, res) => {
  try {
    if (!pool) {
      return res.json([]);
    }

    const [rows] = await pool.query(
      'SELECT category, COUNT(*) as count FROM topics GROUP BY category ORDER BY count DESC'
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Category stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Default route for Vercel
app.get('/', (req, res) => {
  res.json({ 
    message: 'BINAH API Online', 
    version: '1.0.0',
    endpoints: ['/api/health', '/api/topics', '/api/stats/categories']
  });
});

export default app;