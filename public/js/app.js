// ==========================================
// STATE MANAGEMENT & GLOBALS
// ==========================================
let authToken = localStorage.getItem('token') || '';
let heartbeatIntervalId = null;
let countdownIntervalId = null;
let scheduleEvents = [];
let wishlistNotes = [];
let currentCountdownTarget = null; // datetime string: "YYYY-MM-DDTHH:MM"

// Icon mappings for categories
const categoryIcons = {
  food: 'utensils',
  movie: 'film',
  coffee: 'coffee',
  walk: 'compass',
  other: 'star'
};

// ==========================================
// API CLIENT WRAPPERS
// ==========================================
async function apiCall(endpoint, method = 'GET', body = null, isMultipart = false) {
  const headers = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  if (!isMultipart) {
    headers['Content-Type'] = 'application/json';
  }

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = isMultipart ? body : JSON.stringify(body);
  }

  try {
    const response = await fetch(endpoint, options);
    
    // Check if unauthorized
    if (response.status === 401) {
      handleForceLogout('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
      throw new Error('Unauthorized');
    }
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Đã có lỗi xảy ra');
    }
    return data;
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    throw error;
  }
}

// ==========================================
// VIEW ROUTER
// ==========================================
function showView(viewName) {
  const loginView = document.getElementById('login-container');
  const appView = document.getElementById('app-container');
  
  if (viewName === 'login') {
    loginView.classList.add('active');
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
    appView.classList.remove('active');
    stopHeartbeat();
    stopCountdown();
  } else if (viewName === 'app') {
    appView.classList.add('active');
    appView.classList.remove('hidden');
    loginView.classList.add('hidden');
    loginView.classList.remove('active');
    startHeartbeat();
  }
}

// ==========================================
// AUTHENTICATION LOGIC
// ==========================================
async function checkAuthOnLoad() {
  // If there's an image saved in the settings, load it even before login
  try {
    const info = await fetch('/api/info').then(res => res.json());
    if (info && info.background_image_url) {
      updateBackgroundImage(info.background_image_url);
    }
  } catch (e) {
    console.warn("Could not load background pre-auth", e);
  }

  if (authToken) {
    try {
      // Test the token by trying to fetch the main app data
      const data = await apiCall('/api/data');
      handleDataLoaded(data);
      showView('app');
    } catch (err) {
      // Token is invalid/expired
      localStorage.removeItem('token');
      authToken = '';
      showView('login');
    }
  } else {
    showView('login');
  }
}

function handleForceLogout(message) {
  localStorage.removeItem('token');
  authToken = '';
  showView('login');
  if (message) {
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
  }
}

// ==========================================
// HEARTBEAT LOOP (visitor session keep-alive)
// ==========================================
function startHeartbeat() {
  stopHeartbeat(); // Clear any existing
  
  // First heartbeat immediately
  sendHeartbeat();
  
  heartbeatIntervalId = setInterval(sendHeartbeat, 5000);
}

function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

async function sendHeartbeat() {
  try {
    const res = await apiCall('/api/heartbeat', 'POST');
    if (res.success) {
      updateActiveVisitorsBadge(res.activeCount, res.max_visitors);
    }
  } catch (err) {
    console.warn("Heartbeat error, forcing logout:", err);
  }
}

function updateActiveVisitorsBadge(count, max) {
  const textEl = document.getElementById('active-count-text');
  textEl.textContent = `${count} / ${max} online`;
}

// ==========================================
// DATA LOADING & RENDERING
// ==========================================
function handleDataLoaded(data) {
  scheduleEvents = data.schedule || [];
  wishlistNotes = data.wishlist || [];
  
  if (data.settings) {
    if (data.settings.background_image_url) {
      updateBackgroundImage(data.settings.background_image_url);
      document.getElementById('settings-bg-url').value = data.settings.background_image_url;
    }
    if (data.settings.max_visitors) {
      document.getElementById('settings-max-visitors').value = data.settings.max_visitors;
    }

    // Populate Love Clock Settings Form
    if (data.settings.lc_start_date) document.getElementById('lc-start-date-input').value = data.settings.lc_start_date;
    if (data.settings.lc_name_me) document.getElementById('lc-name-me-input').value = data.settings.lc_name_me;
    if (data.settings.lc_name_them) document.getElementById('lc-name-them-input').value = data.settings.lc_name_them;
    if (data.settings.lc_age_me) document.getElementById('lc-age-me-input').value = data.settings.lc_age_me;
    if (data.settings.lc_age_them) document.getElementById('lc-age-them-input').value = data.settings.lc_age_them;
    if (data.settings.lc_zodiac_me) document.getElementById('lc-zodiac-me-input').value = data.settings.lc_zodiac_me;
    if (data.settings.lc_zodiac_them) document.getElementById('lc-zodiac-them-input').value = data.settings.lc_zodiac_them;

    // Render Love Clock
    renderLoveClock(data.settings);
  }
  
  renderTimeline();
  renderWishlist();
  initCountdown();
}

function updateBackgroundImage(url) {
  const bgEl = document.getElementById('app-background');
  if (url) {
    bgEl.style.backgroundImage = `url('${url}')`;
  } else {
    bgEl.style.backgroundImage = ''; // Fall back to default CSS gradient
  }
}

// Render Timeline Events
function renderTimeline() {
  const listEl = document.getElementById('timeline-list');
  listEl.innerHTML = '';
  
  if (scheduleEvents.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar"></i>
        <p>Hiện chưa có kế hoạch nào được lên lịch.</p>
        <p style="font-size: 0.8rem; margin-top: 6px;">Bấm nút phía trên để bắt đầu thêm buổi hẹn hò đầu tiên! 💕</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  scheduleEvents.forEach(event => {
    // Format date beautifully
    const dateObj = new Date(event.date);
    const dayStr = dateObj.getDate().toString().padStart(2, '0');
    const monthStr = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const formattedDate = `${dayStr}/${monthStr}/${dateObj.getFullYear()}`;
    
    const iconName = categoryIcons[event.category] || 'star';
    
    // Check if there is a link
    let linkHtml = '';
    if (event.link) {
      linkHtml = `
        <a href="${event.link}" target="_blank" rel="noopener noreferrer" class="timeline-link">
          <i data-lucide="external-link"></i> <span>Xem liên kết</span>
        </a>
      `;
    }
    
    const itemEl = document.createElement('div');
    itemEl.className = 'timeline-item';
    itemEl.innerHTML = `
      <div class="timeline-icon">
        <i data-lucide="${iconName}"></i>
      </div>
      <div class="timeline-content">
        <div class="timeline-header">
          <span class="timeline-date-time">${formattedDate} @ ${event.time}</span>
          <div class="timeline-actions">
            <button class="btn-icon-small edit-btn" data-id="${event.id}" title="Sửa">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn-icon-small delete-btn" data-id="${event.id}" title="Xóa">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
        <div class="timeline-title">${escapeHtml(event.title)}</div>
        ${event.desc ? `<div class="timeline-desc">${escapeHtml(event.desc).replace(/\n/g, '<br>')}</div>` : ''}
        ${linkHtml}
      </div>
    `;
    
    listEl.appendChild(itemEl);
  });
  
  // Attach event listeners to edit and delete buttons
  listEl.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditEventModal(btn.dataset.id));
  });
  
  listEl.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteEvent(btn.dataset.id));
  });
  
  lucide.createIcons();
}

// Render Wishlist Notes
function renderWishlist() {
  const boardEl = document.getElementById('wishlist-board');
  boardEl.innerHTML = '';
  
  if (wishlistNotes.length === 0) {
    boardEl.innerHTML = `
      <div class="empty-state" style="grid-column: span 2;">
        <i data-lucide="heart-handshake"></i>
        <p>Góc nguyện ước đang trống.</p>
        <p style="font-size: 0.8rem; margin-top: 4px;">Hãy viết những việc hai bạn muốn làm cùng nhau nhé!</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  wishlistNotes.forEach(note => {
    const cardEl = document.createElement('div');
    cardEl.className = 'wish-card animate-zoom';
    cardEl.innerHTML = `
      <div class="wish-pin"></div>
      <div class="wish-content">${escapeHtml(note.content)}</div>
      <div class="wish-footer">
        <button class="wish-delete-btn" data-id="${note.id}" title="Xóa điều ước này">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `;
    boardEl.appendChild(cardEl);
  });
  
  // Attach listeners to note delete buttons
  boardEl.querySelectorAll('.wish-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteWish(btn.dataset.id));
  });
  
  lucide.createIcons();
}

// ==========================================
// LOVE CLOCK LOGIC
// ==========================================
let loveClockInterval = null;

function renderLoveClock(settings) {
  if (settings.lc_name_me) document.getElementById('lc-name-me').textContent = settings.lc_name_me;
  if (settings.lc_name_them) document.getElementById('lc-name-them').textContent = settings.lc_name_them;
  if (settings.lc_age_me) document.getElementById('lc-age-me').innerHTML = `🎂 ${settings.lc_age_me}`;
  if (settings.lc_age_them) document.getElementById('lc-age-them').innerHTML = `🎂 ${settings.lc_age_them}`;
  if (settings.lc_zodiac_me) document.getElementById('lc-zodiac-me').innerHTML = `⭐ ${settings.lc_zodiac_me}`;
  if (settings.lc_zodiac_them) document.getElementById('lc-zodiac-them').innerHTML = `⭐ ${settings.lc_zodiac_them}`;
  
  if (settings.lc_avatar_me_url) document.getElementById('lc-avatar-me').src = settings.lc_avatar_me_url;
  if (settings.lc_avatar_them_url) document.getElementById('lc-avatar-them').src = settings.lc_avatar_them_url;
  
  if (settings.lc_start_date) {
    const d = new Date(settings.lc_start_date);
    const dateStr = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
    document.getElementById('lc-start-date').textContent = `Kể từ: ${dateStr}`;
    
    if (loveClockInterval) clearInterval(loveClockInterval);
    updateLoveClockTick(d);
    loveClockInterval = setInterval(() => updateLoveClockTick(d), 1000);
  }
}

function updateLoveClockTick(startDate) {
  const now = new Date();
  
  let years = now.getFullYear() - startDate.getFullYear();
  let months = now.getMonth() - startDate.getMonth();
  let days = now.getDate() - startDate.getDate();
  
  if (days < 0) {
    months--;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  
  const weeks = Math.floor(days / 7);
  days = days % 7;
  
  document.getElementById('lc-years').textContent = years;
  document.getElementById('lc-months').textContent = months;
  document.getElementById('lc-weeks').textContent = weeks;
  document.getElementById('lc-days').textContent = days;
  
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  document.getElementById('lc-clock').textContent = `${h} : ${m} : ${s}`;
}

// ==========================================
// COUNTDOWN TIMER LOGIC
// ==========================================
function initCountdown() {
  stopCountdown();
  
  // Find the next upcoming event
  const now = new Date();
  const upcomingEvents = scheduleEvents
    .filter(event => {
      const eventDateTime = new Date(`${event.date}T${event.time}`);
      return eventDateTime > now;
    })
    .sort((a, b) => {
      return new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`);
    });
    
  if (upcomingEvents.length > 0) {
    const nextEvent = upcomingEvents[0];
    currentCountdownTarget = new Date(`${nextEvent.date}T${nextEvent.time}`);
    
    // Set hint title
    const dateObj = new Date(nextEvent.date);
    const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth()+1).toString().padStart(2, '0')}`;
    document.getElementById('next-event-title').innerHTML = `
      Hẹn hò: <strong>${escapeHtml(nextEvent.title)}</strong> lúc ${nextEvent.time} ngày ${formattedDate} 💕
    `;
    
    runCountdownTick();
    countdownIntervalId = setInterval(runCountdownTick, 1000);
  } else {
    document.getElementById('next-event-title').textContent = 'Hãy lên lịch cho buổi hẹn tiếp theo của chúng mình nhé! 🥰';
    updateCountdownDisplay(0, 0, 0, 0);
  }
}

function stopCountdown() {
  if (countdownIntervalId) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
  currentCountdownTarget = null;
}

function runCountdownTick() {
  if (!currentCountdownTarget) return;
  
  const now = new Date().getTime();
  const distance = currentCountdownTarget.getTime() - now;
  
  if (distance < 0) {
    stopCountdown();
    // Re-check for any next upcoming events
    initCountdown();
    return;
  }
  
  const days = Math.floor(distance / (1000 * 60 * 60 * 24));
  const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((distance % (1000 * 60)) / 1000);
  
  updateCountdownDisplay(days, hours, minutes, seconds);
}

function updateCountdownDisplay(d, h, m, s) {
  document.getElementById('days').textContent = d.toString().padStart(2, '0');
  document.getElementById('hours').textContent = h.toString().padStart(2, '0');
  document.getElementById('minutes').textContent = m.toString().padStart(2, '0');
  document.getElementById('seconds').textContent = s.toString().padStart(2, '0');
}

// ==========================================
// SCHEDULE FORM SUBMIT / DELETE
// ==========================================
async function handleEventSubmit(e) {
  e.preventDefault();
  
  const eventId = document.getElementById('event-id').value;
  const payload = {
    date: document.getElementById('event-date').value,
    time: document.getElementById('event-time').value,
    title: document.getElementById('event-title').value,
    desc: document.getElementById('event-desc').value,
    link: document.getElementById('event-link').value,
    category: document.querySelector('input[name="event-category"]:checked').value
  };
  
  try {
    let result;
    if (eventId) {
      // Edit mode
      result = await apiCall(`/api/schedule/${eventId}`, 'PUT', payload);
    } else {
      // Add mode
      result = await apiCall('/api/schedule', 'POST', payload);
    }
    
    if (result.success) {
      scheduleEvents = result.schedule;
      renderTimeline();
      initCountdown();
      closeModal('event-modal');
    }
  } catch (err) {
    alert(err.message || 'Lỗi lưu lịch trình');
  }
}

async function deleteEvent(id) {
  if (!confirm('Bạn yêu có chắc muốn xóa lịch hẹn này không? 🥺')) return;
  
  try {
    const res = await apiCall(`/api/schedule/${id}`, 'DELETE');
    if (res.success) {
      scheduleEvents = res.schedule;
      renderTimeline();
      initCountdown();
    }
  } catch (err) {
    alert(err.message || 'Lỗi khi xóa lịch trình');
  }
}

function openAddEventModal() {
  document.getElementById('event-modal-title').textContent = 'Thêm Lịch Trình Hẹn Hò';
  document.getElementById('event-id').value = '';
  document.getElementById('event-form').reset();
  
  // Set default values (today's date)
  document.getElementById('event-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('event-time').value = '19:00';
  document.querySelector('input[name="event-category"][value="food"]').checked = true;
  
  openModal('event-modal');
}

function openEditEventModal(id) {
  const event = scheduleEvents.find(item => item.id === id);
  if (!event) return;
  
  document.getElementById('event-modal-title').textContent = 'Chỉnh Sửa Lịch Trình';
  document.getElementById('event-id').value = event.id;
  document.getElementById('event-date').value = event.date;
  document.getElementById('event-time').value = event.time;
  document.getElementById('event-title').value = event.title;
  document.getElementById('event-desc').value = event.desc || '';
  document.getElementById('event-link').value = event.link || '';
  
  const categoryRadio = document.querySelector(`input[name="event-category"][value="${event.category}"]`);
  if (categoryRadio) {
    categoryRadio.checked = true;
  }
  
  openModal('event-modal');
}

// ==========================================
// WISHLIST SUBMIT / DELETE
// ==========================================
async function handleWishSubmit() {
  const inputEl = document.getElementById('wishlist-input');
  const content = inputEl.value.trim();
  
  if (!content) return;
  
  try {
    const res = await apiCall('/api/wishlist', 'POST', { content });
    if (res.success) {
      wishlistNotes = res.wishlist;
      renderWishlist();
      inputEl.value = '';
    }
  } catch (err) {
    alert(err.message || 'Lỗi thêm điều ước');
  }
}

async function deleteWish(id) {
  try {
    const res = await apiCall(`/api/wishlist/${id}`, 'DELETE');
    if (res.success) {
      wishlistNotes = res.wishlist;
      renderWishlist();
    }
  } catch (err) {
    alert(err.message || 'Lỗi khi xóa ghi chú');
  }
}

// ==========================================
// SETTINGS HANDLER
// ==========================================
async function handleSettingsSubmit(e) {
  e.preventDefault();
  
  const password = document.getElementById('settings-password').value;
  const maxVisitors = document.getElementById('settings-max-visitors').value;
  const bgUrl = document.getElementById('settings-bg-url').value;
  
  const payload = {};
  if (password.trim().length > 0) payload.password = password;
  if (maxVisitors.trim().length > 0) payload.max_visitors = maxVisitors;
  if (bgUrl !== undefined) payload.background_image_url = bgUrl;
  
  payload.lc_start_date = document.getElementById('lc-start-date-input').value;
  payload.lc_name_me = document.getElementById('lc-name-me-input').value;
  payload.lc_name_them = document.getElementById('lc-name-them-input').value;
  payload.lc_age_me = document.getElementById('lc-age-me-input').value;
  payload.lc_age_them = document.getElementById('lc-age-them-input').value;
  payload.lc_zodiac_me = document.getElementById('lc-zodiac-me-input').value;
  payload.lc_zodiac_them = document.getElementById('lc-zodiac-them-input').value;
  
  const msgEl = document.getElementById('settings-message');
  msgEl.className = 'alert';
  msgEl.classList.add('hidden');
  
  try {
    const res = await apiCall('/api/settings', 'POST', payload);
    if (res.success) {
      msgEl.textContent = 'Đã lưu cài đặt thành công! ✨';
      msgEl.classList.add('alert-success');
      msgEl.classList.remove('hidden');
      
      // Apply background immediately
      updateBackgroundImage(res.settings.background_image_url);
      renderLoveClock(res.settings);
      
      // Clear password field
      document.getElementById('settings-password').value = '';
      
      setTimeout(() => {
        closeModal('settings-modal');
        msgEl.classList.add('hidden');
      }, 1500);
    }
  } catch (err) {
    msgEl.textContent = err.message || 'Lỗi khi cập nhật cài đặt.';
    msgEl.classList.add('alert-danger');
    msgEl.classList.remove('hidden');
  }
}

async function handleBgFileUpload(e) {
  const fileInput = e.target;
  const file = fileInput.files[0];
  if (!file) return;
  
  const statusEl = document.getElementById('upload-status');
  statusEl.textContent = 'Đang tải ảnh lên... ⏳';
  
  const formData = new FormData();
  formData.append('bgImage', file);
  
  try {
    const res = await apiCall('/api/upload-bg', 'POST', formData, true);
    if (res.success) {
      statusEl.textContent = 'Đã tải lên và áp dụng ảnh nền mới! 🎉';
      updateBackgroundImage(res.background_image_url);
      document.getElementById('settings-bg-url').value = res.background_image_url;
    }
  } catch (err) {
    statusEl.textContent = `Lỗi tải ảnh lên: ${err.message}`;
  }
}

async function handleAvatarUpload(e, type) {
  const fileInput = e.target;
  const file = fileInput.files[0];
  if (!file) return;
  
  const statusEl = document.getElementById(`lc-avatar-${type}-status`);
  statusEl.textContent = 'Đang tải ảnh lên... ⏳';
  
  const formData = new FormData();
  formData.append('avatarImage', file);
  
  try {
    const res = await apiCall(`/api/upload-avatar-${type}`, 'POST', formData, true);
    if (res.success) {
      statusEl.textContent = 'Đã tải lên ảnh mới! 🎉';
      document.getElementById(`lc-avatar-${type}`).src = res.avatar_url;
    }
  } catch (err) {
    statusEl.textContent = `Lỗi tải ảnh lên: ${err.message}`;
  }
}

// ==========================================
// FLOATING HEARTS GENERATOR
// ==========================================
function startHeartRain() {
  const container = document.getElementById('hearts-container');
  if (!container) return;
  
  // Create a heart every 800ms
  setInterval(() => {
    // Limit total hearts on screen to prevent browser lag (max 30)
    if (container.children.length > 30) {
      container.removeChild(container.firstChild);
    }
    
    const heart = document.createElement('div');
    heart.className = 'floating-heart';
    
    // Create random scale, speed and positions
    const size = Math.random() * 20 + 12; // 12px to 32px
    const left = Math.random() * 100; // 0% to 100%
    const duration = Math.random() * 6 + 7; // 7s to 13s
    const opacity = Math.random() * 0.4 + 0.3; // 0.3 to 0.7
    const swayDuration = Math.random() * 2 + 3; // 3s to 5s
    
    heart.style.left = `${left}%`;
    heart.style.width = `${size}px`;
    heart.style.height = `${size}px`;
    heart.style.opacity = opacity;
    heart.style.animationDuration = `${duration}s, ${swayDuration}s`;
    
    // SVG heart path
    heart.innerHTML = `
      <svg viewBox="0 0 24 24" width="100%" height="100%">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
      </svg>
    `;
    
    container.appendChild(heart);
    
    // Auto-remove after animation completes to avoid memory leak
    setTimeout(() => {
      if (heart.parentNode === container) {
        container.removeChild(heart);
      }
    }, duration * 1000);
  }, 800);
}

// ==========================================
// MODAL HELPER FUNCTIONS
// ==========================================
function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('hidden');
  
  // Reset scroll on modal content open
  const content = modal.querySelector('.modal-content');
  if (content) content.scrollTop = 0;
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// INITIALIZATION & EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Login Form Submission
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const passwordEl = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    
    try {
      const res = await apiCall('/api/login', 'POST', { password: passwordEl.value });
      if (res.success && res.token) {
        authToken = res.token;
        localStorage.setItem('token', authToken);
        passwordEl.value = '';
        
        // Fetch fresh data and enter app
        const data = await apiCall('/api/data');
        handleDataLoaded(data);
        showView('app');
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Mật khẩu sai hoặc phòng đã đầy.';
      errorEl.classList.remove('hidden');
    }
  });

  // Logout Button
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (confirm('Bạn yêu muốn đăng xuất đúng không? 👋')) {
      try {
        await apiCall('/api/logout', 'POST');
      } catch (err) {
        console.warn("Logout request failed:", err);
      }
      handleForceLogout();
    }
  });

  // Settings Modal controls
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    // Clear status and open
    document.getElementById('upload-status').textContent = 'Chưa chọn ảnh nào.';
    document.getElementById('settings-password').value = '';
    document.getElementById('settings-message').classList.add('hidden');
    openModal('settings-modal');
  });

  document.getElementById('settings-form').addEventListener('submit', handleSettingsSubmit);
  document.getElementById('settings-bg-file').addEventListener('change', handleBgFileUpload);
  document.getElementById('lc-avatar-me-file').addEventListener('change', (e) => handleAvatarUpload(e, 'me'));
  document.getElementById('lc-avatar-them-file').addEventListener('change', (e) => handleAvatarUpload(e, 'them'));

  // Event Modal controls
  document.getElementById('btn-add-event').addEventListener('click', openAddEventModal);
  document.getElementById('event-form').addEventListener('submit', handleEventSubmit);

  // Close Modals listeners (all Close buttons and overlays)
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    });
  });

  // Wishlist Submit
  document.getElementById('btn-add-wish').addEventListener('click', handleWishSubmit);
  document.getElementById('wishlist-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleWishSubmit();
    }
  });

  // Start heart rain animation
  startHeartRain();

  // Run Auth Check on page load
  checkAuthOnLoad();
});
