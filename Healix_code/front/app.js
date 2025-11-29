// Healix React Application - Main App Component with all pages and logic
const { useState, useEffect, createContext, useContext, useRef } = React;

// ==============================
// CONTEXT & STATE MANAGEMENT
// ==============================
const AppContext = createContext();
const useAppContext = () => useContext(AppContext);

// In-memory storage, used as a fallback when localStorage isn't available
const memoryStorage = {
  data: {},
  get: (key) => memoryStorage.data[key] || null,
  set: (key, value) => {
    memoryStorage.data[key] = value;
  },
  remove: (key) => {
    delete memoryStorage.data[key];
  }
};

// Persistent storage wrapper using localStorage when possible
const storage = {
  get: (key) => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return memoryStorage.get(key);
    }
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  },
  set: (key, value) => {
    if (typeof window === 'undefined' || !window.localStorage) {
      memoryStorage.set(key, value);
      return;
    }
    try {
      const serialized = JSON.stringify(value);
      window.localStorage.setItem(key, serialized);
    } catch {
      window.localStorage.setItem(key, String(value));
    }
  },
  remove: (key) => {
    if (typeof window === 'undefined' || !window.localStorage) {
      memoryStorage.remove(key);
      return;
    }
    window.localStorage.removeItem(key);
  }
};

// Configure API base URL - change this if backend is on different port/domain
const API_BASE_URL = (typeof window !== 'undefined' && window.__HEALIX_API_BASE_URL__) 
  ? window.__HEALIX_API_BASE_URL__ 
  : 'http://localhost:5000'; // Default to backend server

// Session management
const getSessionId = () => {
  let sessionId = storage.get('healix_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    storage.set('healix_session_id', sessionId);
  }
  return sessionId;
};

async function sendMessageToHealixBackend(message) {
  try {
    const sessionId = getSessionId();
    const response = await fetch(`${API_BASE_URL}/api/chatbot/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'Server error, please try again.');
    }
    return data;
  } catch (error) {
    console.error('Chatbot request failed:', error);
    throw new Error(error.message || 'Network error — please try again.');
  }
}

async function fetchMedicalReport(reportId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/report/${reportId}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch report:', error);
    return null;
  }
}

async function bookAppointment(appointmentData) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/book-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appointmentData)
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to book appointment:', error);
    throw error;
  }
}

async function sendMessageToDoctor(messageData) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messageData)
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to send message:', error);
    throw error;
  }
}

// Mock API - Authentication
const mockAuth = {
  signup: async (userData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, message: data.message || 'Signup failed' };
      }
      if (data.token) {
        storage.set('healix_token', data.token);
      }
      if (data.user) {
        storage.set('healix_session', data.user);
      }
      return { success: true, user: data.user };
    } catch (err) {
      console.error('Signup failed', err);
      return { success: false, message: 'Network error during signup' };
    }
  },
  login: async (email, password, role) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return { success: false, message: data.message || 'Login failed' };
      }
      if (data.token) {
        storage.set('healix_token', data.token);
      }
      if (data.user) {
        storage.set('healix_session', data.user);
      }
      return { success: true, user: data.user };
    } catch (err) {
      console.error('Login failed', err);
      return { success: false, message: 'Network error during login' };
    }
  },
  logout: () => {
    storage.remove('healix_session');
    storage.remove('healix_token');
  },
  getSession: () => storage.get('healix_session')
};

// Mock API - Chat & Reports
const mockChat = {
  saveMessage: (userId, message, sender) => {
    const conversations = storage.get('healix_conversations') || {};
    if (!conversations[userId]) {
      conversations[userId] = [];
    }
    conversations[userId].push({ message, sender, timestamp: Date.now() });
    storage.set('healix_conversations', conversations);
  },
  getConversations: (userId) => {
    const conversations = storage.get('healix_conversations') || {};
    return conversations[userId] || [];
  },
  generateReport: (userId, userName, conversation) => {
    const reports = storage.get('healix_reports') || [];
    const symptoms = extractSymptoms(conversation);
    const summary = generateSummary(conversation);
    const doctors = storage.get('healix_users').filter(u => u.role === 'doctor');
    const assignedDoctor = doctors[Math.floor(Math.random() * doctors.length)];
    
    const report = {
      id: Date.now().toString(),
      patientName: userName,
      patientId: userId,
      symptomsExtracted: symptoms,
      chatSummary: summary,
      timestamp: Date.now(),
      assignedDoctorId: assignedDoctor?.id || 'unassigned',
      reviewed: false
    };
    reports.push(report);
    storage.set('healix_reports', reports);
    return report;
  },
  getDoctorReports: (doctorId) => {
    const reports = storage.get('healix_reports') || [];
    return reports.filter(r => r.assignedDoctorId === doctorId);
  },
  markReviewed: (reportId) => {
    const reports = storage.get('healix_reports') || [];
    const report = reports.find(r => r.id === reportId);
    if (report) report.reviewed = true;
    storage.set('healix_reports', reports);
  },
  deleteReport: (reportId) => {
    let reports = storage.get('healix_reports') || [];
    reports = reports.filter(r => r.id !== reportId);
    storage.set('healix_reports', reports);
  }
};

function extractSymptoms(conversation) {
  const keywords = ['headache', 'fever', 'cough', 'pain', 'tired', 'dizzy', 'nausea', 'sore throat', 'cold', 'flu'];
  const found = [];
  conversation.forEach(msg => {
    keywords.forEach(kw => {
      if (msg.message.toLowerCase().includes(kw) && !found.includes(kw)) {
        found.push(kw);
      }
    });
  });
  return found.length > 0 ? found.join(', ') : 'General consultation';
}

function generateSummary(conversation) {
  return conversation.slice(-3).map(c => c.message).join(' | ');
}

// ==============================
// APP PROVIDER
// ==============================
function AppProvider({ children }) {
  const [theme, setTheme] = useState('light');
  const [user, setUser] = useState(() => mockAuth.getSession());
  const [currentPage, setCurrentPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    const root = document.getElementById('root-theme');
    root.setAttribute('data-theme', theme);
    root.className = theme === 'dark' 
      ? 'min-h-screen bg-[#2B2F36] text-[#F4F7FA]'
      : 'min-h-screen bg-[#F4F7FA] text-[#212529]';
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const login = async (email, password, role) => {
    const result = await mockAuth.login(email, password, role);
    if (result.success) {
      setUser(result.user);
      setCurrentPage(result.user.role === 'doctor' ? 'doctor-dashboard' : 'patient-dashboard');
      showToast('Login successful!');
    } else {
      showToast(result.message);
    }
    return result;
  };

  const signup = async (userData) => {
    const result = await mockAuth.signup(userData);
    if (result.success) {
      showToast('Signup successful! Please login.');
      setCurrentPage('login');
    } else {
      showToast(result.message);
    }
    return result;
  };

  const logout = () => {
    mockAuth.logout();
    setUser(null);
    setCurrentPage('home');
    showToast('Logged out successfully');
  };

  const showToast = (message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000);
  };

  return React.createElement(AppContext.Provider, {
    value: {
      theme,
      toggleTheme,
      user,
      login,
      signup,
      logout,
      currentPage,
      setCurrentPage,
      sidebarOpen,
      setSidebarOpen,
      chatOpen,
      setChatOpen,
      showToast
    }
  }, children, toastMessage && React.createElement(Toast, { message: toastMessage }));
}

// ==============================
// COMPONENTS
// ==============================

// Toast Notification
function Toast({ message }) {
  return React.createElement('div', {
    className: 'fixed bottom-4 right-4 z-50 bg-[#1F7AE0] text-white px-6 py-3 rounded-xl shadow-xl animate-slide-up',
    style: { animation: 'slideUp 0.3s ease' }
  }, message);
}

// Header / Navbar
function Header() {
  const { theme, toggleTheme, sidebarOpen, setSidebarOpen, user, currentPage, setCurrentPage } = useAppContext();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isHomePage = false; // keep header styling consistent on hero
  const headerBg = scrolled || !isHomePage
    ? (theme === 'dark' ? 'bg-[#1f2125]/95' : 'bg-white/95')
    : 'bg-transparent';
  const borderClass = scrolled || !isHomePage
    ? (theme === 'dark' ? 'border-b border-gray-700/60' : 'border-b border-gray-200/70')
    : '';

  return React.createElement('header', {
    className: `sticky top-0 z-40 backdrop-blur ${headerBg} ${borderClass} ${scrolled || !isHomePage ? 'shadow-sm' : ''} transition-all duration-300`
  },
    React.createElement('div', { className: 'container mx-auto px-4 py-3 flex items-center justify-between gap-6' },
      // Left: Logo & Brand
      React.createElement('div', { className: 'flex items-center gap-3 cursor-pointer', onClick: () => setCurrentPage('home') },
        React.createElement('div', {
          id: 'logo-placeholder',
          'aria-label': 'logo placeholder',
          className: `w-10 h-10 md:w-11 md:h-11 rounded-2xl border ${theme === 'dark' ? 'border-gray-600 bg-[#2b2f36]' : 'border-[#cfe2ff] bg-[#e3f2fd]'} shadow-md flex items-center justify-center font-bold text-lg md:text-xl text-[#1F7AE0] transition-all`
        }, 'H'),
        React.createElement('div', {},
          React.createElement('h1', {
            className: 'font-bold tracking-tight text-lg md:text-xl text-[#0B63D6] transition-all'
          }, 'Healix'),
          React.createElement('p', {
            className: `text-[11px] md:text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} transition-all`
          }, 'Smart digital healthcare')
        )
      ),
      // Center: Main navigation (desktop)
      React.createElement('nav', { className: 'hidden md:flex items-center gap-6 text-sm font-medium' },
        ['Home', 'Doctors', 'About', 'Contact'].map(item =>
          React.createElement('button', {
            key: item,
            type: 'button',
            onClick: () => setCurrentPage(
              item === 'Home'
                ? 'home'
                : item === 'Doctors'
                ? 'doctors'
                : item === 'About'
                ? 'about'
                : 'connect'
            ),
            className: `${(!scrolled && isHomePage) ? 'text-white/90 hover:text-white' : (theme === 'dark' ? 'text-gray-200 hover:text-white' : 'text-gray-700 hover:text-[#0B63D6]')} transition-colors`
          }, item)
        )
      ),
      // Right: Auth actions + theme + mobile menu
      React.createElement('div', { className: 'flex items-center gap-2 md:gap-4' },
        !user && React.createElement('div', { className: 'hidden sm:flex items-center gap-2' },
          React.createElement('button', {
            type: 'button',
            onClick: () => setCurrentPage('login'),
            className: `px-3 py-1.5 rounded-full text-xs md:text-sm font-medium border ${
              theme === 'dark'
                ? 'border-gray-500 text-gray-100 hover:bg-gray-700'
                : 'border-[#1F7AE0] text-[#1F7AE0] hover:bg-[#e3f2fd]'
            } transition-colors`
          }, 'Login'),
          React.createElement('button', {
            type: 'button',
            onClick: () => setCurrentPage('signup'),
            className: `px-3.5 py-1.5 rounded-full text-xs md:text-sm font-semibold shadow-sm ${
              'bg-[#1F7AE0] text-white hover:bg-[#0B63D6]'
            } transition-colors`
          }, 'Sign Up')
        ),
        React.createElement('button', {
          type: 'button',
          onClick: toggleTheme,
          className: `p-2 rounded-full border ${
            theme === 'dark'
              ? 'border-gray-600 bg-[#2b2f36] hover:bg-[#3d4149] text-gray-200'
              : 'border-gray-200 bg-white hover:bg-gray-100 text-gray-700'
          } transition-colors`,
          'aria-label': 'Toggle theme'
        }, theme === 'dark' ? '🌞' : '🌙'),
        React.createElement('button', {
          type: 'button',
          onClick: () => setSidebarOpen(!sidebarOpen),
          className: `p-2 text-2xl md:hidden ${
            (!scrolled && isHomePage) ? 'text-white' : (theme === 'dark' ? 'text-gray-300' : 'text-gray-700')
          } transition-colors`,
          'aria-label': 'Open menu'
        }, '☰')
      )
    )
  );
}

// Sidebar Menu
function Sidebar() {
  const { sidebarOpen, setSidebarOpen, theme, user, logout, setCurrentPage } = useAppContext();

  const menuItems = [
    { label: 'Profile', page: 'profile', icon: '👤' },
    { label: 'Our Doctors', page: 'doctors', icon: '🩺' },
    { label: 'Connect With Us', page: 'connect', icon: '📧' },
    { label: 'About Us', page: 'about', icon: 'ℹ️' }
  ];

  if (!sidebarOpen) return null;

  return React.createElement('div', {
    className: 'fixed inset-0 z-50',
    onClick: () => setSidebarOpen(false)
  },
    React.createElement('div', {
      className: `fixed top-0 right-0 h-full w-72 ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} shadow-2xl transform transition-transform duration-300`,
      onClick: (e) => e.stopPropagation()
    },
      React.createElement('div', { className: 'p-6' },
        React.createElement('button', {
          onClick: () => setSidebarOpen(false),
          className: 'text-2xl mb-6',
          'aria-label': 'Close menu'
        }, '✕'),
        React.createElement('nav', { className: 'space-y-3' },
          menuItems.map(item => React.createElement('button', {
            key: item.page,
            onClick: () => {
              setCurrentPage(item.page);
              setSidebarOpen(false);
            },
            className: `w-full text-left px-4 py-3 rounded-lg ${theme === 'dark' ? 'hover:bg-[#3d4149]' : 'hover:bg-gray-100'} transition flex items-center gap-3`
          }, item.icon, item.label))
        ),
        user && React.createElement('button', {
          onClick: () => {
            logout();
            setSidebarOpen(false);
          },
          className: 'w-full mt-6 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition'
        }, 'Logout')
      )
    )
  );
}

// Floating Chatbot Button & Modal
function ChatbotFAB() {
  const { chatOpen, setChatOpen, user } = useAppContext();

  // Hide chatbot for doctors; focus chatbot on patients/guests
  if (user && user.role === 'doctor') return null;

  return React.createElement(React.Fragment, {},
    React.createElement('button', {
      type: 'button',
      onClick: () => setChatOpen(true),
      className: 'fixed bottom-6 right-6 z-40 w-16 h-16 bg-gradient-to-br from-[#1F7AE0] to-[#0B63D6] text-white rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center justify-center text-2xl',
      'aria-label': 'Open chatbot'
    }, '💬'),
    chatOpen && React.createElement(ChatbotModal, { onClose: () => setChatOpen(false) })
  );
}

// Chatbot Modal (frontend-only UI, talks to backend)
function ChatbotModal({ onClose }) {
  const { theme } = useAppContext();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const sendMessage = async () => {
    if (!input.trim() || typing) return;
    const outgoingText = input;
    setInput('');

    const userMsg = { message: outgoingText, sender: 'user', timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    setTyping(true);
    try {
      const response = await sendMessageToHealixBackend(outgoingText);
      const botReply = response?.bot_reply || response?.answer || 'I am sorry, I could not process that.';
      const metaData = {
        symptoms: response?.symptoms || [],
        prediction: response?.prediction || null,
        confidence: typeof response?.confidence === 'number' ? response.confidence : null
      };
      const hasMetaData = (metaData.symptoms && metaData.symptoms.length > 0) || metaData.prediction || typeof metaData.confidence === 'number';
      const botMsg = {
        message: botReply,
        sender: 'bot',
        timestamp: Date.now(),
        data: hasMetaData ? metaData : null
      };
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
      const errorMsg = error.message || 'Could not reach the medical assistant.';
      const botMsg = { message: errorMsg, sender: 'bot', timestamp: Date.now() };
      setMessages(prev => [...prev, botMsg]);
    } finally {
      setTyping(false);
    }
  };

  return React.createElement('div', {
    className: 'fixed inset-0 z-50 flex items-end justify-end p-4',
    onClick: onClose
  },
    React.createElement('div', {
      className: `w-full max-w-md h-[600px] ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-2xl flex flex-col`,
      onClick: (e) => e.stopPropagation()
    },
      // Header
      React.createElement('div', { className: 'bg-gradient-to-r from-[#1F7AE0] to-[#0B63D6] text-white p-4 rounded-t-2xl flex justify-between items-center' },
        React.createElement('div', {},
          React.createElement('h3', { className: 'font-bold text-lg' }, 'Health Assistant'),
          React.createElement('p', { className: 'text-xs opacity-90' }, '🟢 Online')
        ),
        React.createElement('button', { type: 'button', onClick: onClose, className: 'text-2xl', 'aria-label': 'Close chat' }, '✕')
      ),
      // Messages
      React.createElement('div', { className: 'flex-1 overflow-y-auto p-4 space-y-3' },
        messages.map((msg, idx) => React.createElement('div', {
          key: idx,
          className: `flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`
        },
          React.createElement('div', {
            className: `max-w-xs px-4 py-2 rounded-lg ${msg.sender === 'user' ? 'bg-[#1F7AE0] text-white' : (theme === 'dark' ? 'bg-[#3d4149]' : 'bg-gray-200')}`
          },
            React.createElement('div', {}, msg.message),
            msg.sender === 'bot' && msg.data && React.createElement('div', {
              className: `mt-2 text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`
            },
              msg.data.symptoms && msg.data.symptoms.length > 0 && React.createElement('p', {}, `Symptoms detected: ${msg.data.symptoms.join(', ')}`),
              msg.data.prediction && React.createElement('p', {}, `Prediction: ${msg.data.prediction}${typeof msg.data.confidence === 'number' ? ` (${Math.round(msg.data.confidence * 100)}% confidence)` : ''}`)
            )
          )
        )),
        typing && React.createElement('div', { className: 'flex justify-start' },
          React.createElement('div', { className: `px-4 py-2 rounded-lg ${theme === 'dark' ? 'bg-[#3d4149]' : 'bg-gray-200'}` }, 'Typing...')
        ),
        React.createElement('div', { ref: chatEndRef })
      ),
      // Input
      React.createElement('div', { className: 'p-4 border-t flex gap-2' },
        React.createElement('input', {
          type: 'text',
          value: input,
          onChange: (e) => setInput(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              sendMessage();
            }
          },
          placeholder: 'Type your message...',
          className: `flex-1 px-4 py-2 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        React.createElement('button', {
          type: 'button',
          onClick: sendMessage,
          className: 'px-4 py-2 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition',
          'aria-label': 'Send message'
        }, '➤')
      )
    )
  );
}


// ==============================
// PAGES
// ==============================

// Homepage
function HomePage() {
  const { setCurrentPage, theme, user } = useAppContext();

  return React.createElement('div', { className: 'min-h-screen' },
    // Hero Section with Gradient Background and SVG Icons
    React.createElement('section', {
      className: 'relative h-[55vh] sm:h-[60vh] md:h-[75vh] lg:h-[80vh] flex items-center justify-center overflow-hidden',
      style: {
        background: 'linear-gradient(135deg, #1F7AE0 0%, #0B63D6 100%)'
      }
    },
      // SVG Medical Icons - Top Left (Stethoscope)
      React.createElement('svg', {
        className: 'absolute top-10 left-10 opacity-20',
        width: '120',
        height: '120',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'white',
        strokeWidth: '1.5'
      },
        React.createElement('path', { d: 'M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3' }),
        React.createElement('path', { d: 'M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4' }),
        React.createElement('circle', { cx: '20', cy: '10', r: '2' })
      ),
      // SVG Medical Icons - Top Right (Heart)
      React.createElement('svg', {
        className: 'absolute top-16 right-16 opacity-20',
        width: '100',
        height: '100',
        viewBox: '0 0 24 24',
        fill: 'white',
        stroke: 'white',
        strokeWidth: '1.5'
      },
        React.createElement('path', { d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' })
      ),
      // SVG Medical Icons - Bottom Left (Chart)
      React.createElement('svg', {
        className: 'absolute bottom-20 left-16 opacity-15',
        width: '110',
        height: '110',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'white',
        strokeWidth: '1.5'
      },
        React.createElement('line', { x1: '18', y1: '20', x2: '18', y2: '10' }),
        React.createElement('line', { x1: '12', y1: '20', x2: '12', y2: '4' }),
        React.createElement('line', { x1: '6', y1: '20', x2: '6', y2: '14' })
      ),
      // SVG Medical Icons - Bottom Right (Pills)
      React.createElement('svg', {
        className: 'absolute bottom-24 right-20 opacity-20',
        width: '90',
        height: '90',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'white',
        strokeWidth: '1.5'
      },
        React.createElement('rect', { x: '8', y: '8', width: '8', height: '8', rx: '4', transform: 'rotate(45 12 12)' }),
        React.createElement('line', { x1: '8.5', y1: '8.5', x2: '15.5', y2: '15.5' })
      ),
      // SVG Medical Icons - Center Right (Medical Cross)
      React.createElement('svg', {
        className: 'absolute top-1/3 right-8 opacity-10',
        width: '80',
        height: '80',
        viewBox: '0 0 24 24',
        fill: 'white',
        stroke: 'white',
        strokeWidth: '1.5'
      },
        React.createElement('path', { d: 'M11 2h2v8h8v4h-8v8h-2v-8H3v-4h8z' })
      ),
      // SVG Medical Icons - Center Left (Clipboard)
      React.createElement('svg', {
        className: 'absolute top-1/2 left-8 opacity-10',
        width: '85',
        height: '85',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'white',
        strokeWidth: '1.5'
      },
        React.createElement('path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }),
        React.createElement('rect', { x: '8', y: '2', width: '8', height: '4', rx: '1' })
      ),
      // Hero Content
      React.createElement('div', { className: 'relative z-10 text-center px-4 max-w-4xl mx-auto flex flex-col items-center gap-5 md:gap-6' },
        // Logo H circle
        React.createElement('div', {
          className: 'w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 bg-[#1F7AE0] rounded-full flex items-center justify-center shadow-2xl animate-fade-in',
          style: { boxShadow: '0 8px 24px rgba(31, 122, 224, 0.4)' }
        },
          React.createElement('span', {
            className: 'text-white font-bold text-3xl sm:text-4xl md:text-5xl'
          }, 'H')
        ),
        // Main Heading - Healix
        React.createElement('h1', {
          className: 'text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white animate-fade-in',
          style: { textShadow: '2px 4px 12px rgba(0,0,0,0.5)', lineHeight: '1.1', letterSpacing: '-0.02em' }
        }, 'Healix'),
        // Tagline
        React.createElement('p', {
          className: 'text-lg sm:text-xl md:text-2xl lg:text-3xl text-white font-semibold animate-fade-in',
          style: { textShadow: '1px 2px 8px rgba(0,0,0,0.5)' }
        }, 'Your health is our priority'),
        // Description
        React.createElement('p', {
          className: 'text-sm sm:text-base md:text-lg lg:text-xl text-white px-4 max-w-3xl animate-fade-in',
          style: { textShadow: '1px 2px 6px rgba(0,0,0,0.5)', lineHeight: '1.6' }
        }, 'Experience modern healthcare at your fingertips. Connect with healthcare professionals, manage your health records, and get instant assistance through our AI-powered platform.'),
        // CTA Buttons
        React.createElement('div', { className: 'flex gap-4 justify-center flex-wrap animate-fade-in px-4 mt-2' },
          !user
            ? React.createElement(React.Fragment, {},
                React.createElement('button', {
                  onClick: () => setCurrentPage('login'),
                  className: 'px-6 sm:px-8 py-3 sm:py-4 bg-[#1F7AE0] text-white rounded-xl hover:bg-[#0B63D6] transition-all shadow-2xl font-bold text-base sm:text-lg transform hover:scale-105',
                  style: { minWidth: '140px' }
                }, 'Login'),
                React.createElement('button', {
                  onClick: () => setCurrentPage('signup'),
                  className: 'px-6 sm:px-8 py-3 sm:py-4 bg-transparent text-white rounded-xl hover:bg-white hover:text-[#1F7AE0] transition-all shadow-2xl font-bold text-base sm:text-lg border-2 border-white transform hover:scale-105',
                  style: { minWidth: '140px' }
                }, 'Sign Up')
              )
            : React.createElement('button', {
                onClick: () => setCurrentPage(user.role === 'doctor' ? 'doctor-dashboard' : 'patient-dashboard'),
                className: 'px-8 sm:px-10 py-3 sm:py-4 bg-white text-[#0B63D6] rounded-xl hover:bg-blue-50 transition-all shadow-2xl font-bold text-base sm:text-lg transform hover:scale-105',
                style: { minWidth: '180px' }
              }, 'Go to your dashboard')
        )
      )
    ),
    // Feature Cards Section
    React.createElement('section', {
      className: `py-12 md:py-16 px-4 ${theme === 'dark' ? 'bg-[#2B2F36]' : 'bg-gray-50'}`
    },
      React.createElement('div', { className: 'container mx-auto max-w-6xl' },
        React.createElement('div', { className: 'grid gap-6 md:grid-cols-3' },
          // Feature Card 1
          React.createElement('div', {
            className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6 md:p-8 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border-t-4 border-[#1F7AE0]`
          },
            React.createElement('div', {
              className: 'w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 mx-auto',
              style: { background: 'rgba(31, 122, 224, 0.1)' }
            },
              React.createElement('span', { className: 'text-3xl' }, '👨‍⚕️')
            ),
            React.createElement('h3', { className: 'text-xl font-bold mb-3 text-[#1F7AE0] text-center' }, 'Expert Doctors'),
            React.createElement('p', { className: `text-center ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Highly qualified and experienced medical professionals dedicated to your health')
          ),
          // Feature Card 2
          React.createElement('div', {
            className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6 md:p-8 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border-t-4 border-[#1F7AE0]`
          },
            React.createElement('div', {
              className: 'w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 mx-auto',
              style: { background: 'rgba(31, 122, 224, 0.1)' }
            },
              React.createElement('span', { className: 'text-3xl' }, '🕐')
            ),
            React.createElement('h3', { className: 'text-xl font-bold mb-3 text-[#1F7AE0] text-center' }, '24/7 Support'),
            React.createElement('p', { className: `text-center ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Round the clock customer support and emergency assistance available anytime')
          ),
          // Feature Card 3
          React.createElement('div', {
            className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6 md:p-8 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 border-t-4 border-[#1F7AE0]`
          },
            React.createElement('div', {
              className: 'w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 mx-auto',
              style: { background: 'rgba(31, 122, 224, 0.1)' }
            },
              React.createElement('span', { className: 'text-3xl' }, '📋')
            ),
            React.createElement('h3', { className: 'text-xl font-bold mb-3 text-[#1F7AE0] text-center' }, 'Health Reports'),
            React.createElement('p', { className: `text-center ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Comprehensive health reports generated from your consultations and medical history')
          )
        )
      )
    ),
    // How It Works Section
    React.createElement('section', {
      className: `py-12 md:py-16 px-4 ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'}`
    },
      React.createElement('div', { className: 'container mx-auto max-w-6xl' },
        React.createElement('h2', { className: 'text-3xl md:text-4xl font-bold text-center mb-4 text-[#1F7AE0]' }, 'How It Works'),
        React.createElement('p', { className: `text-center mb-12 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Get started in 4 simple steps'),
        React.createElement('div', { className: 'grid gap-8 md:grid-cols-4' },
          [1, 2, 3, 4].map((step, idx) => {
            const steps = [
              { title: 'Create Account', desc: 'Sign up as a patient or doctor in minutes', icon: '📝' },
              { title: 'Connect', desc: 'Choose your preferred doctor or start chatting with our AI assistant', icon: '🔗' },
              { title: 'Consult', desc: 'Have conversations about your health concerns', icon: '💬' },
              { title: 'Get Report', desc: 'Receive comprehensive health reports and recommendations', icon: '📊' }
            ];
            return React.createElement('div', { key: step, className: 'text-center' },
              React.createElement('div', {
                className: 'w-20 h-20 bg-gradient-to-br from-[#1F7AE0] to-[#0B63D6] text-white rounded-full flex items-center justify-center mb-4 mx-auto text-2xl font-bold shadow-lg'
              }, step),
              React.createElement('h3', { className: 'text-lg font-bold mb-2 text-[#1F7AE0]' }, steps[idx].title),
              React.createElement('p', { className: `text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, steps[idx].desc)
            );
          })
        )
      )
    ),
    // Featured Doctors Section with REAL Photos
    React.createElement('section', {
      className: `py-12 md:py-16 px-4 ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'}`
    },
      React.createElement('div', { className: 'container mx-auto max-w-6xl' },
        React.createElement('h2', { className: 'text-3xl md:text-4xl font-bold text-center mb-4 text-[#1F7AE0]' }, 'Meet Our Expert Doctors'),
        React.createElement('p', { className: `text-center mb-12 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Experienced professionals dedicated to your health and wellbeing'),
        React.createElement('div', { className: 'grid gap-6 md:grid-cols-3 mb-8' },
          [
            { 
              name: 'Dr. Ahmed Hassan', 
              specialty: 'Cardiologist', 
              experience: '12+ years', 
              email: 'ahmed@healix.com',
              phone: '+20123456789',
              photo: 'https://pplx-res.cloudinary.com/image/upload/v1762456660/pplx_project_search_images/cf7b11f699b3e15d34010bd677f219dfc4fe3131.png'
            },
            { 
              name: 'Dr. Fatima Ali', 
              specialty: 'Pediatrician', 
              experience: '8+ years', 
              email: 'fatima@healix.com',
              phone: '+20198765432',
              photo: 'https://pplx-res.cloudinary.com/image/upload/v1762456660/pplx_project_search_images/65caddccb7a5552bca00426c86451003a7eb71d0.png'
            },
            { 
              name: 'Dr. Mohamed Ibrahim', 
              specialty: 'Neurologist', 
              experience: '15+ years', 
              email: 'mohamed@healix.com',
              phone: '+20155544332',
              photo: 'https://pplx-res.cloudinary.com/image/upload/v1762456660/pplx_project_search_images/7a3e6300738ab5d7c6d9e0f46d46f3ecb20e8724.png'
            }
          ].map((doctor, idx) => React.createElement('div', {
            key: idx,
            className: `${theme === 'dark' ? 'bg-[#3d4149]' : 'bg-gray-50'} rounded-2xl p-6 text-center hover:shadow-xl transition-all transform hover:-translate-y-1 hover:scale-105 duration-300`
          },
            React.createElement('div', {
              className: 'w-48 h-48 mx-auto mb-4 rounded-xl overflow-hidden shadow-lg',
              style: { border: '3px solid #1F7AE0' }
            },
              React.createElement('img', {
                src: doctor.photo,
                alt: `${doctor.name} - ${doctor.specialty}`,
                className: 'w-full h-full object-cover',
                style: { objectPosition: 'center top' }
              })
            ),
            React.createElement('h3', { className: 'text-lg font-bold mb-1' }, doctor.name),
            React.createElement('p', { className: 'text-[#1F7AE0] font-semibold mb-2' }, doctor.specialty),
            React.createElement('p', { className: `text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} mb-2` }, doctor.experience),
            React.createElement('p', { className: `text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'} mb-1` }, `📧 ${doctor.email}`),
            React.createElement('p', { className: `text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}` }, `📞 ${doctor.phone}`)
          ))
        ),
        React.createElement('div', { className: 'text-center' },
          React.createElement('button', {
            onClick: () => setCurrentPage('doctors'),
            className: 'px-8 py-3 bg-[#1F7AE0] text-white rounded-xl hover:bg-[#0B63D6] transition shadow-lg font-semibold'
          }, 'View All Doctors →')
        )
      )
    ),
    // Testimonials Section
    React.createElement('section', {
      className: `py-12 md:py-16 px-4 ${theme === 'dark' ? 'bg-[#2B2F36]' : 'bg-gray-50'}`
    },
      React.createElement('div', { className: 'container mx-auto max-w-6xl' },
        React.createElement('h2', { className: 'text-3xl md:text-4xl font-bold text-center mb-4 text-[#1F7AE0]' }, 'What Our Patients Say'),
        React.createElement('p', { className: `text-center mb-12 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Real experiences from real patients'),
        React.createElement('div', { className: 'grid gap-6 md:grid-cols-2 lg:grid-cols-3' },
          [
            { name: 'Sarah Johnson', quote: 'Healix made healthcare so easy! The chatbot helped me get quick answers and the doctors are amazing.', rating: 5 },
            { name: 'Michael Chen', quote: 'Best healthcare platform I have used. Fast responses, professional doctors, and great user experience.', rating: 5 },
            { name: 'Emma Williams', quote: 'The 24/7 support is a lifesaver. I can get medical advice anytime I need it. Highly recommended!', rating: 5 }
          ].map((testimonial, idx) => React.createElement('div', {
            key: idx,
            className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl p-6 shadow-lg`
          },
            React.createElement('div', { className: 'flex gap-1 mb-3' },
              Array(testimonial.rating).fill(0).map((_, i) => React.createElement('span', { key: i, className: 'text-yellow-400 text-xl' }, '⭐'))
            ),
            React.createElement('p', { className: `mb-4 italic ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}` }, `"${testimonial.quote}"`),
            React.createElement('p', { className: 'font-semibold text-[#1F7AE0]' }, testimonial.name)
          ))
        )
      )
    ),
    // Quick Links Section
    React.createElement('section', {
      className: `py-12 md:py-16 px-4 ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'}`
    },
      React.createElement('div', { className: 'container mx-auto max-w-4xl text-center' },
        React.createElement('h2', { className: 'text-2xl md:text-3xl font-bold mb-8 text-[#1F7AE0]' }, 'Ready to Get Started?'),
        React.createElement('p', { className: `mb-8 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Join thousands of patients and doctors using Healix for better healthcare'),
        React.createElement('div', { className: 'flex gap-4 justify-center flex-wrap mb-8' },
          React.createElement('button', {
            onClick: () => setCurrentPage('signup'),
            className: 'px-8 py-4 bg-gradient-to-r from-[#1F7AE0] to-[#0B63D6] text-white rounded-xl hover:shadow-2xl transition-all transform hover:scale-105 font-bold text-lg'
          }, 'Get Started Now →')
        )
      )
    ),
    // Footer
    React.createElement('footer', {
      className: `py-8 md:py-12 px-4 ${theme === 'dark' ? 'bg-[#1f2125]' : 'bg-[#f8f9fa]'} border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`
    },
      React.createElement('div', { className: 'container mx-auto max-w-6xl' },
        React.createElement('div', { className: 'grid gap-8 md:grid-cols-4 mb-8' },
          // Column 1: About
          React.createElement('div', {},
            React.createElement('h3', { className: 'font-bold text-lg mb-3 text-[#1F7AE0]' }, 'Healix'),
            React.createElement('p', { className: `text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}` }, 'Your health is our priority. Modern healthcare platform connecting patients with expert doctors.')
          ),
          // Column 2: Quick Links
          React.createElement('div', {},
            React.createElement('h3', { className: 'font-bold text-lg mb-3 text-[#1F7AE0]' }, 'Quick Links'),
            ['Home', 'Our Doctors', 'About Us', 'Connect With Us'].map(link => React.createElement('button', {
              key: link,
              onClick: () => setCurrentPage(link === 'Home' ? 'home' : link.toLowerCase().replace(/ /g, '-')),
              className: `block text-sm mb-2 ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-[#1F7AE0]'} transition`
            }, link))
          ),
          // Column 3: Services
          React.createElement('div', {},
            React.createElement('h3', { className: 'font-bold text-lg mb-3 text-[#1F7AE0]' }, 'Services'),
            ['Patient Registration', 'Doctor Consultation', 'AI Health Assistant', 'Health Reports'].map(service => React.createElement('p', {
              key: service,
              className: `text-sm mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`
            }, service))
          ),
          // Column 4: Contact
          React.createElement('div', {},
            React.createElement('h3', { className: 'font-bold text-lg mb-3 text-[#1F7AE0]' }, 'Contact'),
            React.createElement('p', { className: `text-sm mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}` }, '📧 info@healix.com'),
            React.createElement('p', { className: `text-sm mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}` }, '📞 +01000196592'),
            React.createElement('p', { className: `text-sm mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}` }, '📍 24/7 Support Available')
          )
        ),
        // Bottom bar
        React.createElement('div', { className: `pt-6 border-t ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'} flex flex-col md:flex-row justify-between items-center gap-4` },
          React.createElement('p', { className: `text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}` }, `© ${new Date().getFullYear()} Healix. All rights reserved.`),
          React.createElement('div', { className: 'flex gap-4' },
            ['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map(item => React.createElement('button', {
              key: item,
              className: `text-sm ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-[#1F7AE0]'} transition`
            }, item))
          )
        )
      )
    )
  );
}

// Signup Page
function SignupPage() {
  const { signup, theme } = useAppContext();
  const [role, setRole] = useState('patient');
  const [formData, setFormData] = useState({
    fullName: '', age: '', gender: '', email: '', password: '', confirmPassword: '',
    specialty: '', mobile: '', hospitalCode: ''
  });
  const [passwordStrength, setPasswordStrength] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (name === 'password') {
      setPasswordStrength(value.length > 8 ? 'Strong' : value.length > 5 ? 'Medium' : 'Weak');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    signup({ ...formData, role });
  };

  return React.createElement('div', { className: 'min-h-screen flex items-center justify-center px-4 py-8' },
    React.createElement('div', { className: `w-full max-w-2xl ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-xl p-8` },
      React.createElement('h2', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'Sign Up'),
      React.createElement('div', { className: 'flex gap-4 mb-6' },
        ['patient', 'doctor'].map(r => React.createElement('button', {
          key: r,
          onClick: () => setRole(r),
          className: `flex-1 py-2 rounded-lg capitalize ${role === r ? 'bg-[#1F7AE0] text-white' : (theme === 'dark' ? 'bg-[#3d4149]' : 'bg-gray-200')}`
        }, r))
      ),
      React.createElement('form', { onSubmit: handleSubmit, className: 'space-y-4' },
        React.createElement('input', {
          type: 'text',
          name: 'fullName',
          placeholder: 'Full Name',
          required: true,
          value: formData.fullName,
          onChange: handleChange,
          className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        React.createElement('input', {
          type: 'number',
          name: 'age',
          placeholder: 'Age',
          required: true,
          value: formData.age,
          onChange: handleChange,
          className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        React.createElement('div', { className: 'flex gap-4' },
          ['Male', 'Female', 'Other'].map(g => React.createElement('label', { key: g, className: 'flex items-center gap-2' },
            React.createElement('input', {
              type: 'radio',
              name: 'gender',
              value: g,
              checked: formData.gender === g,
              onChange: handleChange,
              className: 'accent-[#1F7AE0]'
            }),
            g
          ))
        ),
        role === 'doctor' && React.createElement(React.Fragment, {},
          React.createElement('select', {
            name: 'specialty',
            required: true,
            value: formData.specialty,
            onChange: handleChange,
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          },
            React.createElement('option', { value: '' }, 'Select Specialty'),
            ['Cardiology', 'Dermatology', 'Neurology', 'Pediatrics', 'Orthopedics', 'General Practice'].map(s => React.createElement('option', { key: s, value: s }, s))
          ),
          React.createElement('input', {
            type: 'tel',
            name: 'mobile',
            placeholder: 'Mobile Number',
            required: true,
            value: formData.mobile,
            onChange: handleChange,
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          })
        ),
        React.createElement('input', {
          type: 'email',
          name: 'email',
          placeholder: 'Email',
          required: true,
          value: formData.email,
          onChange: handleChange,
          className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        React.createElement('div', {},
          React.createElement('input', {
            type: 'password',
            name: 'password',
            placeholder: 'Password',
            required: true,
            value: formData.password,
            onChange: handleChange,
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          passwordStrength && React.createElement('p', { className: 'text-sm mt-1 text-gray-500' }, 'Strength: ', passwordStrength)
        ),
        React.createElement('input', {
          type: 'password',
          name: 'confirmPassword',
          placeholder: 'Confirm Password',
          required: true,
          value: formData.confirmPassword,
          onChange: handleChange,
          className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        role === 'doctor' && React.createElement('input', {
          type: 'text',
          name: 'hospitalCode',
          placeholder: 'Hospital Code',
          required: true,
          value: formData.hospitalCode,
          onChange: handleChange,
          className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        React.createElement('button', {
          type: 'submit',
          className: 'w-full py-3 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition font-semibold'
        }, 'Sign Up')
      )
    )
  );
}

// Login Page
function LoginPage() {
  const { login, theme, setCurrentPage } = useAppContext();
  const [role, setRole] = useState('patient');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    login(email, password, role);
  };

  return React.createElement('div', { className: 'min-h-screen flex items-center justify-center px-4' },
    React.createElement('div', { className: `w-full max-w-md ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-xl p-8` },
      React.createElement('h2', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'Login'),
      React.createElement('div', { className: 'flex gap-4 mb-6' },
        ['patient', 'doctor'].map(r => React.createElement('button', {
          key: r,
          onClick: () => setRole(r),
          className: `flex-1 py-2 rounded-lg capitalize ${role === r ? 'bg-[#1F7AE0] text-white' : (theme === 'dark' ? 'bg-[#3d4149]' : 'bg-gray-200')}`
        }, r))
      ),
      React.createElement('form', { onSubmit: handleSubmit, className: 'space-y-4' },
        React.createElement('input', {
          type: 'email',
          placeholder: 'Email',
          required: true,
          value: email,
          onChange: (e) => setEmail(e.target.value),
          className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        React.createElement('input', {
          type: 'password',
          placeholder: 'Password',
          required: true,
          value: password,
          onChange: (e) => setPassword(e.target.value),
          className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
        }),
        React.createElement('div', { className: 'flex justify-between items-center' },
          React.createElement('label', { className: 'flex items-center gap-2' },
            React.createElement('input', {
              type: 'checkbox',
              checked: remember,
              onChange: (e) => setRemember(e.target.checked),
              className: 'accent-[#1F7AE0]'
            }),
            'Remember Me'
          ),
          React.createElement('button', {
            type: 'button',
            className: 'text-[#1F7AE0] text-sm hover:underline'
          }, 'Forgot Password?')
        ),
        React.createElement('button', {
          type: 'submit',
          className: 'w-full py-3 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition font-semibold'
        }, 'Login'),
        React.createElement('p', { className: 'text-center text-sm mt-4' },
          "Don't have an account? ",
          React.createElement('button', {
            type: 'button',
            onClick: () => setCurrentPage('signup'),
            className: 'text-[#1F7AE0] hover:underline'
          }, 'Sign Up')
        )
      )
    )
  );
}

// Patient Dashboard
function PatientDashboard() {
  const { user, theme, setCurrentPage } = useAppContext();
  const [reports, setReports] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/reports`)
      .then(res => res.json())
      .then(setReports)
      .catch(() => setReports([]));
  }, []);

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-4xl' },
      React.createElement('h1', { className: 'text-4xl font-bold mb-2 text-[#1F7AE0]' }, `Welcome, ${user.fullName}!`),
      React.createElement('p', { className: `mb-8 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, 'Your health dashboard'),
      React.createElement('div', { className: 'grid gap-6 md:grid-cols-2' },
        React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6` },
          React.createElement('h3', { className: 'text-xl font-bold mb-4 text-[#1F7AE0]' }, '👤 Profile Summary'),
          React.createElement('p', {}, `Name: ${user.fullName}`),
          React.createElement('p', {}, `Age: ${user.age}`),
          React.createElement('p', {}, `Gender: ${user.gender}`),
          React.createElement('p', {}, `Email: ${user.email}`),
          React.createElement('button', {
            onClick: () => setCurrentPage('profile'),
            className: 'mt-4 px-6 py-2 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition'
          }, 'Edit Profile')
        ),
        React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6` },
          React.createElement('h3', { className: 'text-xl font-bold mb-4 text-[#1F7AE0]' }, '💬 Messaging'),
          React.createElement('p', { className: 'mb-4' }, 'Send messages to your doctors'),
          React.createElement('button', {
            onClick: () => setCurrentPage('messaging'),
            className: 'px-6 py-2 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition'
          }, 'Open Messages')
        ),
        React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6` },
          React.createElement('h3', { className: 'text-xl font-bold mb-4 text-[#1F7AE0]' }, '📅 Appointments'),
          React.createElement('p', { className: 'mb-4' }, 'View and manage your appointments'),
          React.createElement('button', {
            onClick: () => setCurrentPage('book-appointment'),
            className: 'px-6 py-2 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition'
          }, 'Book Appointment')
        ),
        React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6 md:col-span-2` },
          React.createElement('h3', { className: 'text-xl font-bold mb-4 text-[#1F7AE0]' }, '📝 My Reports'),
          reports.length === 0
            ? React.createElement('p', { className: 'text-gray-500' }, 'No reports available yet.')
            : React.createElement('ul', { className: 'space-y-2' },
                reports.map((r) =>
                  React.createElement('li', {
                    key: r.report_id,
                    className: `${theme === 'dark' ? 'bg-[#3d4149]' : 'bg-gray-50'} rounded-lg px-4 py-3 flex justify-between items-center`
                  },
                    React.createElement('div', {},
                      React.createElement('p', { className: 'font-semibold' }, r.patient?.name || 'Unknown patient'),
                      React.createElement('p', { className: 'text-xs text-gray-500' }, new Date(r.timestamp).toLocaleString())
                    ),
                    React.createElement('div', { className: 'text-right text-xs' },
                      React.createElement('p', {}, 'Top prediction:'),
                      React.createElement('p', { className: 'font-semibold text-[#1F7AE0]' },
                        Object.keys(r.predictions || {})[0] || '—'
                      )
                    )
                  )
                )
              )
        )
      )
    )
  );
}

// Doctor Dashboard
function DoctorDashboard() {
  const { user, theme } = useAppContext();

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-6xl' },
      React.createElement('h1', { className: 'text-4xl font-bold mb-2 text-[#1F7AE0]' }, `Dr. ${user.fullName}`),
      React.createElement('p', { className: `mb-8 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}` }, user.specialty || 'General Practice'),
      React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6` },
        React.createElement('h2', { className: 'text-2xl font-bold mb-4 text-[#1F7AE0]' }, '📥 Reports'),
        React.createElement('p', { className: `${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}` },
          'Report data will be integrated with the backend. For now, there are no mock reports shown here.'
        )
      )
    )
  );
}

// Profile Page
function ProfilePage() {
  const { user, theme, showToast } = useAppContext();
  const [formData, setFormData] = useState({ ...user });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSave = (e) => {
    e.preventDefault();
    const users = storage.get('healix_users') || [];
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx] = formData;
      storage.set('healix_users', users);
      storage.set('healix_session', formData);
      showToast('Profile updated successfully!');
    }
  };

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-2xl' },
      React.createElement('h1', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'Profile'),
      React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6` },
        React.createElement('form', { onSubmit: handleSave, className: 'space-y-4' },
          React.createElement('input', {
            type: 'text',
            name: 'fullName',
            value: formData.fullName,
            onChange: handleChange,
            placeholder: 'Full Name',
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          React.createElement('input', {
            type: 'number',
            name: 'age',
            value: formData.age,
            onChange: handleChange,
            placeholder: 'Age',
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          React.createElement('input', {
            type: 'email',
            name: 'email',
            value: formData.email,
            onChange: handleChange,
            placeholder: 'Email',
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          user.role === 'doctor' && React.createElement(React.Fragment, {},
            React.createElement('input', {
              type: 'text',
              name: 'specialty',
              value: formData.specialty,
              onChange: handleChange,
              placeholder: 'Specialty',
              className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
            }),
            React.createElement('input', {
              type: 'text',
              name: 'hospitalCode',
              value: formData.hospitalCode,
              onChange: handleChange,
              placeholder: 'Hospital Code',
              className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
            })
          ),
          React.createElement('button', {
            type: 'submit',
            className: 'w-full py-3 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition font-semibold'
          }, 'Save Changes')
        )
      )
    )
  );
}

// Our Doctors Page with REAL Photos
function DoctorsPage() {
  const { theme } = useAppContext();
  const [search, setSearch] = useState('');
  
  // Featured doctors with real photos
  const featuredDoctors = [
    { 
      id: 'featured-1',
      fullName: 'Ahmed Hassan', 
      specialty: 'Cardiologist', 
      experience: '12+ years', 
      email: 'ahmed@healix.com',
      mobile: '+20123456789',
      photo: 'https://pplx-res.cloudinary.com/image/upload/v1762456660/pplx_project_search_images/cf7b11f699b3e15d34010bd677f219dfc4fe3131.png'
    },
    { 
      id: 'featured-2',
      fullName: 'Fatima Ali', 
      specialty: 'Pediatrician', 
      experience: '8+ years', 
      email: 'fatima@healix.com',
      mobile: '+20198765432',
      photo: 'https://pplx-res.cloudinary.com/image/upload/v1762456660/pplx_project_search_images/65caddccb7a5552bca00426c86451003a7eb71d0.png'
    },
    { 
      id: 'featured-3',
      fullName: 'Mohamed Ibrahim', 
      specialty: 'Neurologist', 
      experience: '15+ years', 
      email: 'mohamed@healix.com',
      mobile: '+20155544332',
      photo: 'https://pplx-res.cloudinary.com/image/upload/v1762456660/pplx_project_search_images/7a3e6300738ab5d7c6d9e0f46d46f3ecb20e8724.png'
    }
  ];
  
  const registeredDoctors = (storage.get('healix_users') || []).filter(u => u.role === 'doctor');
  const allDoctors = [...featuredDoctors, ...registeredDoctors];
  const filteredDoctors = search ? allDoctors.filter(d => d.specialty?.toLowerCase().includes(search.toLowerCase())) : allDoctors;

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-6xl' },
      React.createElement('h1', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'Our Doctors'),
      React.createElement('input', {
        type: 'text',
        placeholder: 'Search by specialty...',
        value: search,
        onChange: (e) => setSearch(e.target.value),
        className: `w-full mb-6 px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
      }),
      React.createElement('div', { className: 'grid gap-6 md:grid-cols-2 lg:grid-cols-3' },
        filteredDoctors.length === 0 && React.createElement('p', { className: 'col-span-full text-gray-500' }, 'No doctors found'),
        filteredDoctors.map(doctor => React.createElement('div', {
          key: doctor.id,
          className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6 hover:shadow-2xl transition-all transform hover:-translate-y-1 hover:scale-105 duration-300`
        },
          doctor.photo && React.createElement('div', {
            className: 'w-full h-56 mb-4 rounded-xl overflow-hidden shadow-md',
            style: { border: '2px solid #1F7AE0' }
          },
            React.createElement('img', {
              src: doctor.photo,
              alt: `Dr. ${doctor.fullName} - ${doctor.specialty}`,
              className: 'w-full h-full object-cover',
              style: { objectPosition: 'center top' }
            })
          ),
          React.createElement('h3', { className: 'text-xl font-bold mb-2' }, `Dr. ${doctor.fullName}`),
          React.createElement('p', { className: 'text-[#1F7AE0] font-semibold mb-2' }, doctor.specialty),
          doctor.experience && React.createElement('p', { className: `text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} mb-2` }, doctor.experience),
          React.createElement('p', { className: 'text-sm mb-1' }, `📧 ${doctor.email}`),
          React.createElement('p', { className: 'text-sm' }, `📱 ${doctor.mobile || 'N/A'}`)
        ))
      )
    )
  );
}

// Connect With Us Page
function ConnectPage() {
  const { theme, showToast } = useAppContext();
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    showToast('Message sent successfully!');
    setFormData({ name: '', email: '', subject: '', message: '' });
  };

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-2xl' },
      React.createElement('h1', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'Connect With Us'),
      React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6` },
        React.createElement('form', { onSubmit: handleSubmit, className: 'space-y-4' },
          React.createElement('input', {
            type: 'text',
            name: 'name',
            placeholder: 'Your Name',
            required: true,
            value: formData.name,
            onChange: handleChange,
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          React.createElement('input', {
            type: 'email',
            name: 'email',
            placeholder: 'Your Email',
            required: true,
            value: formData.email,
            onChange: handleChange,
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          React.createElement('input', {
            type: 'text',
            name: 'subject',
            placeholder: 'Subject',
            required: true,
            value: formData.subject,
            onChange: handleChange,
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          React.createElement('textarea', {
            name: 'message',
            placeholder: 'Your Message',
            required: true,
            rows: 5,
            value: formData.message,
            onChange: handleChange,
            className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
          }),
          React.createElement('button', {
            type: 'submit',
            className: 'w-full py-3 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition font-semibold'
          }, 'Send Message')
        )
      )
    )
  );
}

// About Us Page
function AboutPage() {
  const { theme } = useAppContext();

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-4xl' },
      React.createElement('h1', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'About Us'),
      React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6 space-y-6` },
        React.createElement('section', {},
          React.createElement('h2', { className: 'text-2xl font-bold mb-3 text-[#1F7AE0]' }, 'Our Mission'),
          React.createElement('p', {}, 'At Healix, our mission is to make quality healthcare accessible to everyone. We connect patients with experienced doctors and provide AI-powered health assistance to ensure timely care and support.')
        ),
        React.createElement('section', {},
          React.createElement('h2', { className: 'text-2xl font-bold mb-3 text-[#1F7AE0]' }, 'Our Vision'),
          React.createElement('p', {}, 'We envision a world where healthcare is seamless, personalized, and available at your fingertips. Through innovative technology and compassionate care, we strive to improve health outcomes for all.')
        ),
        React.createElement('section', {},
          React.createElement('h2', { className: 'text-2xl font-bold mb-3 text-[#1F7AE0]' }, 'Our Values'),
          React.createElement('ul', { className: 'list-disc list-inside space-y-2' },
            React.createElement('li', {}, 'Patient-centric care'),
            React.createElement('li', {}, 'Innovation and technology'),
            React.createElement('li', {}, 'Accessibility and inclusivity'),
            React.createElement('li', {}, 'Trust and transparency')
          )
        )
      )
    )
  );
}

// Book Appointment Page
function BookAppointmentPage() {
  const { user, theme, showToast, setCurrentPage } = useAppContext();
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [appointmentData, setAppointmentData] = useState({
    date: '',
    time: '',
    reason: ''
  });
  const [doctors, setDoctors] = useState([]);
  const [currentReport, setCurrentReport] = useState(null);

  useEffect(() => {
    // Load selected doctor and report from storage
    const doctorId = storage.get('selected_doctor_id');
    const report = storage.get('current_report');
    if (report) setCurrentReport(report);
    
    // Fetch doctors
    fetch(`${API_BASE_URL}/api/doctors`)
      .then(res => res.json())
      .then(data => {
        setDoctors(data);
        if (doctorId) {
          const doctor = data.find(d => d.id === doctorId);
          if (doctor) setSelectedDoctor(doctor);
        }
      })
      .catch(err => console.error('Failed to fetch doctors:', err));
  }, []);

  const handleBook = async (e) => {
    e.preventDefault();
    if (!selectedDoctor || !appointmentData.date || !appointmentData.time) {
      showToast('Please fill in all required fields');
      return;
    }

    try {
      const appointment = await bookAppointment({
        patient_id: user?.id,
        doctor_id: selectedDoctor.id,
        report_id: currentReport?.report_id,
        date: appointmentData.date,
        time: appointmentData.time,
        reason: appointmentData.reason
      });
      showToast('Appointment booked successfully!');
      storage.remove('selected_doctor_id');
      storage.remove('current_report');
      setCurrentPage('patient-dashboard');
    } catch (error) {
      showToast('Failed to book appointment. Please try again.');
    }
  };

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-4xl' },
      React.createElement('h1', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'Book Appointment'),
      
      // Doctor Selection
      !selectedDoctor && React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6 mb-6` },
        React.createElement('h2', { className: 'text-xl font-bold mb-4 text-[#1F7AE0]' }, 'Select a Doctor'),
        React.createElement('div', { className: 'space-y-3' },
          doctors.map(doctor => React.createElement('div', {
            key: doctor.id,
            onClick: () => setSelectedDoctor(doctor),
            className: `p-4 border-2 rounded-lg cursor-pointer transition ${
              theme === 'dark' ? 'border-gray-600 hover:border-[#1F7AE0]' : 'border-gray-200 hover:border-[#1F7AE0]'
            }`
          },
            React.createElement('p', { className: 'font-bold' }, doctor.name),
            React.createElement('p', { className: 'text-[#1F7AE0]' }, doctor.specialty),
            React.createElement('p', { className: 'text-sm text-gray-500' }, doctor.experience)
          ))
        )
      ),

      // Appointment Form
      selectedDoctor && React.createElement('div', { className: `${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg p-6` },
        React.createElement('div', { className: 'mb-6 pb-4 border-b' },
          React.createElement('h2', { className: 'text-xl font-bold mb-2' }, 'Selected Doctor'),
          React.createElement('p', { className: 'font-semibold' }, selectedDoctor.name),
          React.createElement('p', { className: 'text-[#1F7AE0]' }, selectedDoctor.specialty),
          React.createElement('button', {
            onClick: () => setSelectedDoctor(null),
            className: 'mt-2 text-sm text-red-500 hover:underline'
          }, 'Change Doctor')
        ),
        React.createElement('form', { onSubmit: handleBook, className: 'space-y-4' },
          React.createElement('div', {},
            React.createElement('label', { className: 'block mb-2 font-semibold' }, 'Date'),
            React.createElement('input', {
              type: 'date',
              required: true,
              value: appointmentData.date,
              onChange: (e) => setAppointmentData({ ...appointmentData, date: e.target.value }),
              min: new Date().toISOString().split('T')[0],
              className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
            })
          ),
          React.createElement('div', {},
            React.createElement('label', { className: 'block mb-2 font-semibold' }, 'Time'),
            React.createElement('input', {
              type: 'time',
              required: true,
              value: appointmentData.time,
              onChange: (e) => setAppointmentData({ ...appointmentData, time: e.target.value }),
              className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
            })
          ),
          React.createElement('div', {},
            React.createElement('label', { className: 'block mb-2 font-semibold' }, 'Reason (Optional)'),
            React.createElement('textarea', {
              value: appointmentData.reason,
              onChange: (e) => setAppointmentData({ ...appointmentData, reason: e.target.value }),
              rows: 3,
              className: `w-full px-4 py-3 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
            })
          ),
          React.createElement('button', {
            type: 'submit',
            className: 'w-full py-3 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition font-semibold'
          }, 'Confirm Appointment')
        )
      )
    )
  );
}

// Messaging Page
function MessagingPage() {
  const { user, theme, showToast } = useAppContext();
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [doctors, setDoctors] = useState([]);

  useEffect(() => {
    // Fetch doctors for patient, or patients for doctor
    fetch(`${API_BASE_URL}/api/doctors`)
      .then(res => res.json())
      .then(data => setDoctors(data))
      .catch(err => console.error('Failed to fetch:', err));
  }, []);

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation) return;

    try {
      const messageData = {
        from_id: user.id,
        to_id: selectedConversation.id,
        message: newMessage
      };
      await sendMessageToDoctor(messageData);
      setMessages([...messages, { ...messageData, timestamp: new Date().toISOString() }]);
      setNewMessage('');
    } catch (error) {
      showToast('Failed to send message');
    }
  };

  return React.createElement('div', { className: 'min-h-screen p-6' },
    React.createElement('div', { className: 'container mx-auto max-w-6xl' },
      React.createElement('h1', { className: 'text-3xl font-bold mb-6 text-[#1F7AE0]' }, 'Messages'),
      React.createElement('div', { className: `flex gap-6 ${theme === 'dark' ? 'bg-[#32353c]' : 'bg-white'} rounded-2xl shadow-lg overflow-hidden` },
        // Conversations List
        React.createElement('div', { className: `w-1/3 border-r ${theme === 'dark' ? 'border-gray-600' : 'border-gray-200'}` },
          React.createElement('div', { className: 'p-4 border-b' },
            React.createElement('h2', { className: 'font-bold' }, user.role === 'doctor' ? 'Patients' : 'Doctors')
          ),
          React.createElement('div', { className: 'overflow-y-auto max-h-[600px]' },
            (user.role === 'doctor' ? [] : doctors).map(contact => React.createElement('div', {
              key: contact.id,
              onClick: () => setSelectedConversation(contact),
              className: `p-4 cursor-pointer hover:bg-gray-100 ${theme === 'dark' ? 'hover:bg-[#3d4149]' : ''} ${
                selectedConversation?.id === contact.id ? 'bg-blue-50' : ''
              }`
            },
              React.createElement('p', { className: 'font-bold' }, contact.name || contact.fullName),
              React.createElement('p', { className: 'text-sm text-gray-500' }, contact.specialty || 'Patient')
            ))
          )
        ),
        // Messages Area
        React.createElement('div', { className: 'flex-1 flex flex-col' },
          selectedConversation ? React.createElement(React.Fragment, {},
            React.createElement('div', { className: `p-4 border-b ${theme === 'dark' ? 'border-gray-600' : 'border-gray-200'}` },
              React.createElement('p', { className: 'font-bold' }, selectedConversation.name || selectedConversation.fullName),
              React.createElement('p', { className: 'text-sm text-gray-500' }, selectedConversation.specialty || 'Patient')
            ),
            React.createElement('div', { className: 'flex-1 overflow-y-auto p-4 space-y-3' },
              messages.map((msg, idx) => React.createElement('div', {
                key: idx,
                className: `flex ${msg.from_id === user.id ? 'justify-end' : 'justify-start'}`
              },
                React.createElement('div', {
                  className: `max-w-xs px-4 py-2 rounded-lg ${
                    msg.from_id === user.id 
                      ? 'bg-[#1F7AE0] text-white' 
                      : (theme === 'dark' ? 'bg-[#3d4149]' : 'bg-gray-200')
                  }`
                }, msg.message)
              ))
            ),
            React.createElement('div', { className: 'p-4 border-t flex gap-2' },
              React.createElement('input', {
                type: 'text',
                value: newMessage,
                onChange: (e) => setNewMessage(e.target.value),
                onKeyPress: (e) => e.key === 'Enter' && sendMessage(),
                placeholder: 'Type a message...',
                className: `flex-1 px-4 py-2 rounded-lg border ${theme === 'dark' ? 'bg-[#3d4149] border-gray-600' : 'bg-gray-50 border-gray-300'} focus:outline-none focus:ring-2 focus:ring-[#1F7AE0]`
              }),
              React.createElement('button', {
                onClick: sendMessage,
                className: 'px-4 py-2 bg-[#1F7AE0] text-white rounded-lg hover:bg-[#0B63D6] transition'
              }, 'Send')
            )
          ) : React.createElement('div', { className: 'flex-1 flex items-center justify-center' },
            React.createElement('p', { className: 'text-gray-500' }, 'Select a conversation to start messaging')
          )
        )
      )
    )
  );
}

// ==============================
// MAIN APP
// ==============================
function App() {
  const { currentPage, user } = useAppContext();

  const renderPage = () => {
    if (!user) {
      switch(currentPage) {
        case 'signup': return React.createElement(SignupPage);
        case 'login': return React.createElement(LoginPage);
        case 'doctors': return React.createElement(DoctorsPage);
        case 'connect': return React.createElement(ConnectPage);
        case 'about': return React.createElement(AboutPage);
        default: return React.createElement(HomePage);
      }
    } else {
      switch(currentPage) {
        case 'profile': return React.createElement(ProfilePage);
        case 'doctors': return React.createElement(DoctorsPage);
        case 'connect': return React.createElement(ConnectPage);
        case 'about': return React.createElement(AboutPage);
        case 'doctor-dashboard': return React.createElement(DoctorDashboard);
        case 'patient-dashboard': return React.createElement(PatientDashboard);
        case 'book-appointment': return React.createElement(BookAppointmentPage);
        case 'messaging': return React.createElement(MessagingPage);
        default: return user.role === 'doctor' ? React.createElement(DoctorDashboard) : React.createElement(PatientDashboard);
      }
    }
  };

  return React.createElement('div', { className: 'min-h-screen' },
    React.createElement(Header),
    React.createElement(Sidebar),
    renderPage(),
    React.createElement(ChatbotFAB)
  );
}

// ==============================
// MOUNT APP
// ==============================
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(AppProvider, {}, React.createElement(App)));
