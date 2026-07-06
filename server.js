const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Session storage in memory
// token -> { lastSeen: timestamp }
let sessions = {};

// =============================================
// GITHUB API DATABASE (Persistent storage)
// =============================================
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'vuhiuhaikanam-droid/anh-va-nho';
const GITHUB_FILE_PATH = 'database.json';
let cachedSha = null; // cache file SHA for GitHub API

// Detect if app is packaged inside binary (pkg)
const isPackaged = typeof process.pkg !== 'undefined';

// Detect Render.com environment
const isRender = process.env.NODE_ENV === 'production';

// Local DB path (for local dev only)
const DB_PATH = isPackaged
  ? path.join(path.dirname(process.execPath), 'database.json')
  : path.join(__dirname, 'database.json');

// Default initial database content
const defaultData = {
  settings: {
    password: "123456",
    max_visitors: 2,
    background_image_url: "/images/bg.jpg"
  },
  schedule: [
    {
      id: "1",
      date: "2026-07-05",
      time: "18:00",
      title: "Đi ăn tối lãng mạn 🍽️",
      desc: "Đặt bàn trước tại nhà hàng view đẹp để ngắm hoàng hôn cùng nhau.",
      link: "https://maps.google.com",
      category: "food"
    },
    {
      id: "2",
      date: "2026-07-05",
      time: "20:00",
      title: "Xem phim tại rạp 🎬",
      desc: "Đặt vé xem phim tình cảm ngọt ngào, chuẩn bị bỏng ngô và đồ uống.",
      link: "https://www.cgv.vn",
      category: "movie"
    },
    {
      id: "399312d5-47e9-4417-ba9a-2fa85e4ae958",
      date: "2026-07-06",
      time: "19:00",
      title: "xem phim",
      desc: "",
      link: "",
      category: "movie"
    }
  ],
  wishlist: [
    {
      id: "1",
      content: "Cùng ngắm hoàng hôn trên bãi biển 🌅"
    },
    {
      id: "2",
      content: "Học nấu một món ăn mới cùng nhau 🍳"
    }
  ]
};

// ===== GitHub API helpers =====
async function readDb() {
  // Use GitHub API if token is available (production on Render)
  if (GITHUB_TOKEN) {
    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'anh-va-nho-app'
        }
      });

      if (!response.ok) {
        console.error('GitHub API read error:', response.status);
        return defaultData;
      }

      const fileData = await response.json();
      cachedSha = fileData.sha;
      const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
      return JSON.parse(content);
    } catch (err) {
      console.error('Error reading from GitHub:', err);
      return defaultData;
    }
  }

  // Local file fallback (for local development)
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2), 'utf-8');
      return defaultData;
    }
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading local database:", err);
    return defaultData;
  }
}

async function writeDb(data) {
  // Use GitHub API if token is available (production on Render)
  if (GITHUB_TOKEN) {
    try {
      // Get latest SHA if not cached
      if (!cachedSha) {
        const getResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
          headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'anh-va-nho-app'
          }
        });
        if (getResponse.ok) {
          const fileData = await getResponse.json();
          cachedSha = fileData.sha;
        }
      }

      const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
      const putResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'anh-va-nho-app'
        },
        body: JSON.stringify({
          message: 'Update database',
          content: content,
          sha: cachedSha
        })
      });

      if (putResponse.ok) {
        const result = await putResponse.json();
        cachedSha = result.content.sha; // update SHA for next write
        console.log('Database saved to GitHub successfully.');
      } else {
        const errData = await putResponse.json();
        console.error('GitHub API write error:', errData);
        cachedSha = null; // reset SHA on conflict to re-fetch next time
      }
    } catch (err) {
      console.error('Error writing to GitHub:', err);
      cachedSha = null;
    }
    return;
  }

  // Local file fallback (for local development)
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error("Error writing local database:", err);
  }
}

// Clean up expired sessions periodically (every 5 seconds)
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  for (const token in sessions) {
    if (now - sessions[token].lastSeen > 12000) {
      delete sessions[token];
      expiredCount++;
    }
  }
  if (expiredCount > 0) {
    console.log(`Cleaned up ${expiredCount} expired sessions.`);
  }
}, 5000);

// Ensure directories exist
const PUBLIC_DIR = path.join(__dirname, 'public');

// Uploads folder
const uploadsDir = isPackaged
  ? path.join(path.dirname(process.execPath), 'uploads')
  : path.join(PUBLIC_DIR, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage configuration for background image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'bg-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve static files from public directory
app.use(express.static(PUBLIC_DIR));

// Serve uploads folder
app.use('/uploads', express.static(uploadsDir));

// --- API ROUTES ---

// Middleware: Authenticate Session
function auth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || !sessions[token]) {
    return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập lại.' });
  }

  // Refresh lastSeen on successful auth
  sessions[token].lastSeen = Date.now();
  req.token = token;
  next();
}

// Public Settings Info
app.get('/api/info', async (req, res) => {
  const db = await readDb();
  res.json({
    background_image_url: db.settings.background_image_url || ''
  });
});

// Login Endpoint
app.post('/api/login', async (req, res) => {
  const { password } = req.body;
  const db = await readDb();

  if (password !== db.settings.password) {
    return res.status(400).json({ success: false, message: 'Mật khẩu không chính xác.' });
  }

  // Clean up expired sessions first
  const now = Date.now();
  for (const t in sessions) {
    if (now - sessions[t].lastSeen > 12000) {
      delete sessions[t];
    }
  }

  const activeCount = Object.keys(sessions).length;
  const maxVisitors = parseInt(db.settings.max_visitors) || 2;

  if (activeCount >= maxVisitors) {
    return res.status(403).json({
      success: false,
      message: `Phòng đã đầy! Đã đạt giới hạn truy cập đồng thời (${maxVisitors} người). Vui lòng thử lại sau.`
    });
  }

  const token = crypto.randomBytes(16).toString('hex');
  sessions[token] = {
    lastSeen: Date.now()
  };

  res.json({ success: true, token });
});

// Heartbeat Endpoint (keep-alive)
app.post('/api/heartbeat', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token || !sessions[token]) {
    return res.status(401).json({ success: false, message: 'Hết phiên đăng nhập.' });
  }

  sessions[token].lastSeen = Date.now();
  const db = await readDb();

  res.json({
    success: true,
    activeCount: Object.keys(sessions).length,
    max_visitors: db.settings.max_visitors
  });
});

// Logout Endpoint
app.post('/api/logout', auth, (req, res) => {
  delete sessions[req.token];
  res.json({ success: true });
});

// Fetch all schedules, wishlist, and public settings
app.get('/api/data', auth, async (req, res) => {
  const db = await readDb();
  const safeSettings = {
    max_visitors: db.settings.max_visitors,
    background_image_url: db.settings.background_image_url
  };
  res.json({
    schedule: db.schedule,
    wishlist: db.wishlist,
    settings: safeSettings,
    activeCount: Object.keys(sessions).length
  });
});

// Schedule CRUD Endpoints
app.post('/api/schedule', auth, async (req, res) => {
  const { date, time, title, desc, link, category } = req.body;
  if (!title || !date || !time) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ ngày, giờ và tiêu đề.' });
  }

  const db = await readDb();
  const newEvent = {
    id: crypto.randomUUID(),
    date,
    time,
    title,
    desc: desc || '',
    link: link || '',
    category: category || 'other'
  };

  db.schedule.push(newEvent);
  db.schedule.sort((a, b) => {
    const datetimeA = new Date(`${a.date}T${a.time}`);
    const datetimeB = new Date(`${b.date}T${b.time}`);
    return datetimeA - datetimeB;
  });

  await writeDb(db);
  res.json({ success: true, schedule: db.schedule });
});

app.put('/api/schedule/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { date, time, title, desc, link, category } = req.body;
  if (!title || !date || !time) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ ngày, giờ và tiêu đề.' });
  }

  const db = await readDb();
  const index = db.schedule.findIndex(item => item.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy lịch trình này.' });
  }

  db.schedule[index] = {
    id,
    date,
    time,
    title,
    desc: desc || '',
    link: link || '',
    category: category || 'other'
  };

  db.schedule.sort((a, b) => {
    const datetimeA = new Date(`${a.date}T${a.time}`);
    const datetimeB = new Date(`${b.date}T${b.time}`);
    return datetimeA - datetimeB;
  });

  await writeDb(db);
  res.json({ success: true, schedule: db.schedule });
});

app.delete('/api/schedule/:id', auth, async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const filtered = db.schedule.filter(item => item.id !== id);

  if (filtered.length === db.schedule.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy lịch trình cần xóa.' });
  }

  db.schedule = filtered;
  await writeDb(db);
  res.json({ success: true, schedule: db.schedule });
});

// Wishlist Endpoints
app.post('/api/wishlist', auth, async (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ success: false, message: 'Nội dung ghi chú trống.' });
  }

  const db = await readDb();
  const newWish = {
    id: crypto.randomUUID(),
    content
  };

  db.wishlist.push(newWish);
  await writeDb(db);
  res.json({ success: true, wishlist: db.wishlist });
});

app.delete('/api/wishlist/:id', auth, async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const filtered = db.wishlist.filter(item => item.id !== id);

  if (filtered.length === db.wishlist.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy ghi chú.' });
  }

  db.wishlist = filtered;
  await writeDb(db);
  res.json({ success: true, wishlist: db.wishlist });
});

// Settings Update
app.post('/api/settings', auth, async (req, res) => {
  const { password, max_visitors, background_image_url } = req.body;
  const db = await readDb();

  if (password && password.trim().length > 0) {
    db.settings.password = password.trim();
  }
  if (max_visitors !== undefined) {
    const maxVal = parseInt(max_visitors);
    if (isNaN(maxVal) || maxVal < 1) {
      return res.status(400).json({ success: false, message: 'Số lượng truy cập tối đa phải là số nguyên lớn hơn 0.' });
    }
    db.settings.max_visitors = maxVal;
  }
  if (background_image_url !== undefined) {
    db.settings.background_image_url = background_image_url.trim();
  }

  await writeDb(db);
  res.json({ success: true, settings: {
    max_visitors: db.settings.max_visitors,
    background_image_url: db.settings.background_image_url
  }});
});

// Upload Background Image Endpoint
app.post('/api/upload-bg', auth, upload.single('bgImage'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Không tìm thấy tệp tải lên.' });
  }

  const db = await readDb();
  const imageUrl = `/uploads/${req.file.filename}`;
  db.settings.background_image_url = imageUrl;

  await writeDb(db);
  res.json({
    success: true,
    background_image_url: imageUrl
  });
});

// Serve Frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Open default system web browser (only when running as packaged .exe)
function openBrowser(url) {
  const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${startCmd} ${url}`, (err) => {
    if (err) {
      console.error('Không thể tự động mở trình duyệt. Vui lòng mở thủ công tại:', url);
    }
  });
}

// Start Server
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`=========================================`);
  console.log(`ỨNG DỤNG HẸN HÒ: ANH VÀ NHỎ ĐANG CHẠY!`);
  console.log(`Địa chỉ: ${url}`);
  console.log(`GitHub DB: ${GITHUB_TOKEN ? 'BẬT (lưu vĩnh viễn)' : 'TẮT (dùng file local)'}`);
  console.log(`=========================================`);
  if (isPackaged) {
    console.log(`Đang tự động mở trình duyệt web...`);
    openBrowser(url);
  }
});
