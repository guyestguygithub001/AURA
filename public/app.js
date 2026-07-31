// AURA Fluid Client State Controller
let currentPersonaId = '';
let currentPersonaRole = '';
let activeView = 'buyer';
let activeCategory = 'All';
let products = [];
let cart = [];
let searchDebounceTimer = null;
let auditLogsOffset = 0;
let activeTheme = 'dark'; // 'dark' | 'light' | 'system'

// API Config
const API_BASE = '/api/v1';

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initTheme();
  initSession();

  // Check landing page sessionStorage cache
  const landingViewed = sessionStorage.getItem('aura_landing_viewed');
  const hero = document.getElementById('landing-hero-view');
  if (landingViewed === 'true' && hero) {
    hero.style.display = 'none';
  }
  
  // Start polling audit logs & wallet data for real-time ledger representation
  setInterval(() => {
    if (currentPersonaId) {
      pollSystemUpdates();
    }
  }, 3000);
});

// Enter storefront transition
window.enterAURAStorefront = function() {
  const hero = document.getElementById('landing-hero-view');
  if (hero) {
    hero.classList.add('fade-out');
    sessionStorage.setItem('aura_landing_viewed', 'true');
    setTimeout(() => {
      hero.style.display = 'none';
    }, 800);
  }
};

window.exitAURAStorefront = function() {
  const hero = document.getElementById('landing-hero-view');
  if (hero) {
    sessionStorage.removeItem('aura_landing_viewed');
    hero.style.display = 'flex';
    hero.offsetHeight; // Force browser reflow to reset transitions
    hero.classList.remove('fade-out');
  }
};

// Setup Listeners
function setupEventListeners() {
  const personaSelect = document.getElementById('persona-select');
  if (personaSelect) {
    personaSelect.addEventListener('change', () => {
      // Legacy support
    });
  }
}

// Session & Authentication Engine
function initSession() {
  const session = localStorage.getItem('aura_session');
  if (session) {
    const user = JSON.parse(session);
    currentPersonaId = user.id;
    currentPersonaRole = user.role;
    showUserProfile(user);
    
    const closeBtn = document.getElementById('onboard-close-btn');
    if (closeBtn) closeBtn.style.display = 'block';
    
    updateNavigationTabs();
    loadCatalogData();
    pollSystemUpdates();
  } else {
    // Guest User Mode (Anonymous catalog browsing)
    currentPersonaId = '';
    currentPersonaRole = '';
    
    const profileHeader = document.getElementById('user-profile-header');
    const authBtn = document.getElementById('header-auth-btn');
    if (profileHeader && authBtn) {
      profileHeader.style.display = 'none';
      authBtn.style.display = 'block';
    }

    const closeBtn = document.getElementById('onboard-close-btn');
    if (closeBtn) closeBtn.style.display = 'block';
    
    updateNavigationTabs();
    loadCatalogData();
  }
}

function showUserProfile(user) {
  const profileHeader = document.getElementById('user-profile-header');
  const authBtn = document.getElementById('header-auth-btn');
  const userInfo = document.getElementById('header-user-info');
  
  if (profileHeader && authBtn && userInfo) {
    profileHeader.style.display = 'flex';
    authBtn.style.display = 'none';
    userInfo.innerHTML = `<i class="fa-solid fa-user"></i> ${user.name} (${user.role.toUpperCase()}) | <strong style="color: var(--text);">$${user.balance.toFixed(2)}</strong>`;
  }
}

function handleLogout() {
  localStorage.removeItem('aura_session');
  currentPersonaId = '';
  currentPersonaRole = '';
  
  const profileHeader = document.getElementById('user-profile-header');
  const authBtn = document.getElementById('header-auth-btn');
  if (profileHeader && authBtn) {
    profileHeader.style.display = 'none';
    authBtn.style.display = 'block';
  }
  
  // Clear catalog and view state
  products = [];
  renderProducts();
  
  logToLedger('sys', '[Session] User logged out. Clearing active context.');
  initSession();
}

// Theme Engine Initialization
function initTheme() {
  const savedTheme = localStorage.getItem('aura-theme') || 'dark';
  setTheme(savedTheme);
}

function setTheme(theme) {
  activeTheme = theme;
  localStorage.setItem('aura-theme', theme);

  // Toggle active button style
  const themesList = ['dark', 'light', 'system'];
  themesList.forEach(t => {
    const btn = document.getElementById(`theme-btn-${t}`);
    if (btn) btn.classList.toggle('active', t === theme);
  });

  const body = document.body;
  if (theme === 'light') {
    body.classList.add('light-theme');
  } else if (theme === 'dark') {
    body.classList.remove('light-theme');
  } else {
    // System theme sync
    const systemPrefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    body.classList.toggle('light-theme', systemPrefersLight);
  }

  logToLedger('sys', `[Theme Engine] Switched display personalization theme to: ${theme.toUpperCase()}`);
}

// Watch for system theme changes in real-time
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (activeTheme === 'system') {
    setTheme('system');
  }
});

// Fetch helper with auto ledger logging
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const method = options.method || 'GET';
  
  logToLedger('api', `[API Request] ${method} ${url}`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Aura-User-Id': currentPersonaId, // Secure Header Injection
        ...options.headers
      }
    });
    
    const resData = await response.json();
    
    if (!response.ok) {
      logToLedger('err', `[API Error Response] Status ${response.status} - ${resData.message || 'Operation failed'}`);
      if (response.status === 401) {
        localStorage.removeItem('aura_session');
        setTimeout(() => {
          initSession();
        }, 100);
      }
      throw new Error(resData.message || 'Operation failed');
    }
    
    logToLedger('sys', `[API Success Response] ${method} ${endpoint} - Status ${response.status}`);
    return resData;
  } catch (err) {
    if (err.message.includes('Failed to fetch')) {
      logToLedger('err', `[Network Error] Failed to connect to server at ${url}`);
    }
    throw err;
  }
}

// Stream ledger log rows
function logToLedger(type, message) {
  const container = document.getElementById('ledger-logs-stream');
  if (!container) return;
  
  const row = document.createElement('div');
  row.className = `log-row ${type}-log`;
  
  const timestamp = new Date().toLocaleTimeString();
  row.innerText = `[${timestamp}] ${message}`;
  
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  
  // Cap history elements
  while (container.children.length > 100) {
    container.removeChild(container.firstChild);
  }
}

function clearLedger() {
  const container = document.getElementById('ledger-logs-stream');
  if (container) container.innerHTML = '';
}

// Load products
async function loadCatalogData() {
  try {
    const result = await apiRequest('/products');
    products = result.data.products;
    renderProducts();
  } catch (err) {
    console.error('Failed to load products', err);
  }
}

// Render product grid
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  
  // Filter by category
  let filtered = products;
  if (activeCategory !== 'All') {
    filtered = products.filter(p => p.category === activeCategory);
  }
  
  // Filter by search string
  const searchVal = document.getElementById('search-input').value.trim().toLowerCase();
  if (searchVal) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(searchVal) || 
      p.category.toLowerCase().includes(searchVal)
    );
  }
  
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="card" style="grid-column: 1/-1; text-align: center; padding: 3rem;">
        <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; color: var(--border-focus); margin-bottom: 1rem; display: block;"></i>
        <h4>No products found matching the criteria.</h4>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = filtered.map(p => {
    const isOutOfStock = p.stock <= 0;
    const isLowStock = p.stock > 0 && p.stock <= 3;
    let stockClass = 'ok';
    let stockTxt = `In Stock (${p.stock})`;
    
    if (isOutOfStock) {
      stockClass = 'out';
      stockTxt = 'Sold Out';
    } else if (isLowStock) {
      stockClass = 'low';
      stockTxt = `Only ${p.stock} Left`;
    }
    
    return `
      <article class="card product-card">
        <div class="stock-tag ${stockClass}">${stockTxt}</div>
        <div class="product-card-img-placeholder">
          <i class="fa-solid ${getCategoryIcon(p.category)}"></i>
        </div>
        <h4>${escapeHtml(p.name)}</h4>
        <span class="cat">${escapeHtml(p.category)}</span>
        <div class="product-card-footer">
          <span class="price">$${p.price.toFixed(2)}</span>
          <button class="btn btn-primary btn-sm" onclick="addToCart('${p.id}')" ${isOutOfStock ? 'disabled' : ''}>
            <i class="fa-solid fa-cart-plus"></i> Buy Now
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function getCategoryIcon(cat) {
  switch(cat) {
    case 'Electronics': return 'fa-laptop-code';
    case 'Office': return 'fa-compass-drafting';
    case 'Furniture': return 'fa-couch';
    default: return 'fa-box';
  }
}

// Switch dashboard view tabs
function switchView(view) {
  activeView = view;
  
  // Toggle tab buttons
  document.getElementById('tab-buyer').classList.toggle('active', view === 'buyer');
  document.getElementById('tab-merchant').classList.toggle('active', view === 'merchant');
  document.getElementById('tab-admin').classList.toggle('active', view === 'admin');
  
  // Toggle view panels
  document.getElementById('buyer-view').classList.toggle('active', view === 'buyer');
  document.getElementById('merchant-view').classList.toggle('active', view === 'merchant');
  document.getElementById('admin-view').classList.toggle('active', view === 'admin');
  
  logToLedger('sys', `[Client] Switch View Pane: ${view.toUpperCase()}`);
  
  if (view === 'merchant') {
    refreshMerchantView();
  } else if (view === 'admin') {
    refreshAdminView();
  }
}

function updateNavigationTabs() {
  const tabBuyer = document.getElementById('tab-buyer');
  const tabMerchant = document.getElementById('tab-merchant');
  const tabAdmin = document.getElementById('tab-admin');

  // Hide all tabs first
  tabBuyer.style.display = 'none';
  tabMerchant.style.display = 'none';
  tabAdmin.style.display = 'none';

  // Toggle visibility based on role
  if (!currentPersonaRole || currentPersonaRole === 'buyer') {
    tabBuyer.style.display = 'inline-flex';
    switchView('buyer');
  } else if (currentPersonaRole === 'merchant') {
    tabMerchant.style.display = 'inline-flex';
    switchView('merchant');
  } else if (currentPersonaRole === 'admin') {
    tabAdmin.style.display = 'inline-flex';
    switchView('admin');
  }
}

// Search bar filters
function handleSearch(immediate = false) {
  const searchVal = document.getElementById('search-input').value;
  document.getElementById('clear-search-btn').style.display = searchVal ? 'block' : 'none';
  
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  
  if (immediate) {
    logToLedger('sys', `[Client Search] Query immediate trigger: "${searchVal}"`);
    renderProducts();
  } else {
    searchDebounceTimer = setTimeout(() => {
      logToLedger('sys', `[Client Search] Query debounced: "${searchVal}"`);
      renderProducts();
    }, 200);
  }
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('clear-search-btn').style.display = 'none';
  renderProducts();
}

function filterCategory(cat) {
  activeCategory = cat;
  
  const buttons = document.querySelectorAll('.cat-filter');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.innerText === cat);
  });
  
  logToLedger('sys', `[Client Category] Filter category: ${cat}`);
  renderProducts();
}

// Cart drawer toggle
function toggleCart(show) {
  document.getElementById('cart-overlay').classList.toggle('active', show);
  document.getElementById('cart-drawer').classList.toggle('active', show);
  if (show) {
    checkoutGoToStep(1);
    renderCart();
  }
}

// Add item to cart
function addToCart(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;
  
  const existing = cart.find(item => item.product.id === productId);
  if (existing) {
    if (existing.quantity < prod.stock) {
      existing.quantity += 1;
      logToLedger('sys', `[Cart] Incremented quantity for: ${prod.name}`);
    } else {
      logToLedger('err', `[Cart Error] Cannot exceed available stock lock (${prod.stock})`);
      alert(`Cannot add more. Only ${prod.stock} units are currently in stock.`);
      return;
    }
  } else {
    cart.push({ product: prod, quantity: 1 });
    logToLedger('sys', `[Cart] Added product: ${prod.name}`);
  }
  
  updateCartBadge();
  toggleCart(true);
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.product.id !== productId);
  logToLedger('sys', `[Cart] Removed product ID: ${productId}`);
  updateCartBadge();
  renderCart();
}

function updateCartBadge() {
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById('cart-badge-count').innerText = totalItems;
}

// Render Cart
function renderCart() {
  const container = document.getElementById('cart-items-list');
  if (!container) return;
  
  if (cart.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
        <i class="fa-solid fa-basket-shopping" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--border);"></i>
        <p>Your bag is empty.</p>
      </div>
    `;
    document.getElementById('checkout-next-btn').disabled = true;
    document.getElementById('cart-subtotal-val').innerText = '$0.00';
    return;
  }
  
  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-img">
        <i class="fa-solid ${getCategoryIcon(item.product.category)}"></i>
      </div>
      <div class="cart-item-details">
        <h5>${escapeHtml(item.product.name)}</h5>
        <span>Qty: ${item.quantity} (Ver lock: ${item.product.version})</span>
      </div>
      <div class="cart-item-price">$${(item.product.price * item.quantity).toFixed(2)}</div>
      <button class="cart-item-remove" onclick="removeFromCart('${item.product.id}')">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `).join('');
  
  const subtotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  document.getElementById('cart-subtotal-val').innerText = `$${subtotal.toFixed(2)}`;
  document.getElementById('checkout-next-btn').disabled = false;
}

// Checkout Step Swapper
function checkoutGoToStep(step) {
  if (step > 1 && !currentPersonaId) {
    toggleCart(false);
    openOnboarding();
    toggleOnboardMode('login');
    alert('Please log in or sign up to complete your checkout transaction.');
    return;
  }

  const steps = [1, 2, 3];
  steps.forEach(s => {
    document.getElementById(`cart-step-${s}`).classList.toggle('active', s === step);
    const indicator = document.getElementById(`step-${s}-indicator`);
    if (indicator) indicator.classList.toggle('active', s === step);
  });
  
  const stepsBar = document.getElementById('checkout-steps-bar');
  if (step > 1) {
    stepsBar.style.display = 'flex';
  } else {
    stepsBar.style.display = 'none';
  }
  
  if (step === 2) {
    const subtotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    document.getElementById('payable-amount-val').innerText = `$${subtotal.toFixed(2)}`;
  }
}

// Secure checkout submission
async function submitSecureCheckout() {
  if (cart.length === 0) return;
  
  checkoutGoToStep(3);
  document.getElementById('checkout-spinner-pane').style.display = 'flex';
  document.getElementById('checkout-success-pane').style.display = 'none';
  
  setTimeout(async () => {
    try {
      const orderItem = cart[0]; 
      
      const payload = {
        buyerId: currentPersonaId,
        productId: orderItem.product.id,
        quantity: orderItem.quantity,
        expectedVersion: orderItem.product.version
      };
      
      logToLedger('db', `[Database Row Lock] Locking product ID: ${payload.productId} and buyer ID: ${payload.buyerId}`);
      const result = await apiRequest('/orders', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      // Success State
      const order = result.data.order;
      
      document.getElementById('checkout-spinner-pane').style.display = 'none';
      document.getElementById('checkout-success-pane').style.display = 'block';
      
      document.getElementById('receipt-details').innerHTML = `
        <div class="receipt-line"><span>Order Reference</span><strong>${order.id}</strong></div>
        <div class="receipt-line"><span>Status Ledger</span><strong>${order.status} (ESCROW HOLD)</strong></div>
        <div class="receipt-line"><span>Debit Amount</span><strong>$${order.total_amount.toFixed(2)}</strong></div>
        <div class="receipt-line"><span>Audit Key</span><strong>${order.created_at}</strong></div>
      `;
      
      cart = [];
      updateCartBadge();
      loadCatalogData(); 
      
    } catch (err) {
      logToLedger('err', `[Transaction Abort] Lock aborted: ${err.message}`);
      alert(`Checkout failed: ${err.message}`);
      checkoutGoToStep(2);
    }
  }, 1200);
}

function resetCartState() {
  toggleCart(false);
  checkoutGoToStep(1);
}

// Merchant Dashboard functions
async function refreshMerchantView() {
  pollSystemUpdates();
  renderMerchantOrders();
}

async function renderMerchantOrders() {
  const container = document.getElementById('merchant-orders-body');
  if (!container) return;
  
  try {
    const resLogs = await fetch(`${API_BASE}/audit-logs`);
    const logsData = await resLogs.json();
    const logs = logsData.data.logs;

    const ordersMap = {};
    
    logs.forEach(log => {
      if (log.entityType === 'order') {
        const orderId = log.entityId;
        if (!ordersMap[orderId]) {
          ordersMap[orderId] = log.afterState || log.beforeState;
        } else {
          if (new Date(log.timestamp) > new Date(ordersMap[orderId].updated_at)) {
            ordersMap[orderId] = log.afterState || log.beforeState;
          }
        }
      }
    });
    
    // Filter orders corresponding to current persona merchant OR if seller u-2 acts
    const merchantOrders = Object.values(ordersMap)
      .filter(ord => ord.merchant_id === currentPersonaId || (currentPersonaId === 'u-3' && ord.merchant_id === 'u-2'))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    if (merchantOrders.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.5;"></i>
            No active merchant orders.
          </td>
        </tr>
      `;
      return;
    }
    
    container.innerHTML = merchantOrders.map(ord => {
      const prod = products.find(p => p.id === ord.product_id) || { name: 'Unknown Asset' };
      
      let actionBtn = '';
      if (ord.status === 'PAID') {
        actionBtn = `
          <button class="btn btn-primary btn-sm" onclick="shipOrder('${ord.id}')">
            <i class="fa-solid fa-truck-fast"></i> Ship Order
          </button>
        `;
      } else if (ord.status === 'SHIPPED') {
        actionBtn = `
          <button class="btn btn-secondary btn-sm" onclick="deliverOrder('${ord.id}')" style="border-color: var(--success); color: var(--success);">
            <i class="fa-solid fa-circle-check"></i> Mark Delivered
          </button>
        `;
      } else {
        actionBtn = `<span style="font-size:0.75rem; color:var(--text-muted);">Payout Settled</span>`;
      }
      
      return `
        <tr>
          <td><strong>${ord.id}</strong></td>
          <td>${escapeHtml(prod.name)}</td>
          <td>${ord.quantity}</td>
          <td>$${ord.total_amount.toFixed(2)}</td>
          <td>$${ord.net_merchant_payout.toFixed(2)}</td>
          <td><span class="status-pill ${ord.status.toLowerCase()}">${ord.status}</span></td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
    
  } catch (err) {
    console.error(err);
  }
}

async function handleAddProduct(e) {
  e.preventDefault();
  
  const name = document.getElementById('prod-name').value;
  const category = document.getElementById('prod-category').value;
  const price = parseFloat(document.getElementById('prod-price').value);
  const stock = parseInt(document.getElementById('prod-stock').value, 10);
  
  try {
    await apiRequest('/products', {
      method: 'POST',
      body: JSON.stringify({
        name,
        category,
        price,
        stock,
        merchantId: currentPersonaId
      })
    });
    
    document.getElementById('add-product-form').reset();
    await loadCatalogData();
    await refreshMerchantView();
    
    alert('Product successfully published to marketplace catalog.');
  } catch (err) {
    alert(`Failed to add product: ${err.message}`);
  }
}

async function shipOrder(orderId) {
  try {
    await apiRequest(`/orders/${orderId}/ship`, {
      method: 'POST',
      body: JSON.stringify({ merchantId: currentPersonaId })
    });
    await refreshMerchantView();
  } catch (err) {
    alert(`Failed to ship order: ${err.message}`);
  }
}

async function deliverOrder(orderId) {
  try {
    await apiRequest(`/orders/${orderId}/deliver`, {
      method: 'POST',
      body: JSON.stringify({ actorId: currentPersonaId })
    });
    await refreshMerchantView();
  } catch (err) {
    alert(`Failed to complete delivery: ${err.message}`);
  }
}

// Admin Panel View Logic
async function refreshAdminView() {
  pollSystemUpdates();
  renderAdminModerationList();
}

async function renderAdminModerationList() {
  const container = document.getElementById('admin-products-moderation-body');
  if (!container) return;

  try {
    const productsRes = await apiRequest('/products');
    const prods = productsRes.data.products;

    if (prods.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            No items active in system catalog.
          </td>
        </tr>
      `;
      return;
    }

    container.innerHTML = prods.map(p => `
      <tr>
        <td><strong>${p.id}</strong></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>$${p.price.toFixed(2)}</td>
        <td>${p.stock}</td>
        <td><code>${p.merchant_id}</code></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="adminDeleteProduct('${p.id}')" style="border-color: var(--error); color: var(--error);">
            <i class="fa-solid fa-trash-can"></i> Moderate
          </button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    console.error(err);
  }
}

async function adminDeleteProduct(productId) {
  if (!confirm(`Warning: You are deleting listing "${productId}" as an Administrator. Proceed?`)) return;

  try {
    await apiRequest(`/products/${productId}`, {
      method: 'DELETE',
      body: JSON.stringify({ actorId: currentPersonaId })
    });
    
    await loadCatalogData();
    await refreshAdminView();
    alert('Listing successfully purged and soft-deleted from catalog.');
  } catch (err) {
    alert(`Moderation failed: ${err.message}`);
  }
}

// Real-time Polling & System Balances updates
async function pollSystemUpdates() {
  try {
    const usersData = await apiRequest('/users');
    const users = usersData.data.users;
    
    // Find active user profile
    const activeUser = users.find(u => u.id === currentPersonaId);
    if (activeUser) {
      // Update wallet details in header profile context dynamically
      const userInfo = document.getElementById('header-user-info');
      if (userInfo) {
        userInfo.innerHTML = `<i class="fa-solid fa-user"></i> ${activeUser.name} (${activeUser.role.toUpperCase()}) | <strong style="color: var(--text);">$${activeUser.balance.toFixed(2)}</strong>`;
      }
      
      // Update Merchant specific views balance if applicable
      if (activeUser.role === 'merchant') {
        const merchantWallet = document.getElementById('merchant-wallet-val');
        if (merchantWallet) merchantWallet.innerText = `$${activeUser.balance.toFixed(2)}`;
      }
    }

    // Update Admin stats if viewing admin view
    const adminTotalUsers = document.getElementById('admin-total-users-val');
    if (adminTotalUsers) adminTotalUsers.innerText = users.length;

    // Fetch and sync audit logs only if authenticated as system Administrator (RBAC Guard)
    if (currentPersonaRole === 'admin') {
      const logsData = await apiRequest('/audit-logs');
      const logs = logsData.data.logs;
      
      // Calculate total escrow volume & collected fees
      let escrowTotal = 0;
      let commissionTotal = 0;
      const ordersMap = {};

      logs.forEach(log => {
        if (log.entityType === 'order') {
          const orderId = log.entityId;
          if (!ordersMap[orderId]) {
            ordersMap[orderId] = log.afterState || log.beforeState;
          } else if (new Date(log.timestamp) > new Date(ordersMap[orderId].updated_at)) {
            ordersMap[orderId] = log.afterState || log.beforeState;
          }
        }
      });
      
      Object.values(ordersMap).forEach(ord => {
        commissionTotal += ord.fee_collected;
        if (ord.status === 'PAID' || ord.status === 'SHIPPED') {
          escrowTotal += ord.total_amount;
        }
      });

      const merchantEscrow = document.getElementById('merchant-escrow-val');
      if (merchantEscrow) merchantEscrow.innerText = `$${escrowTotal.toFixed(2)}`;
      
      const adminTotalCommission = document.getElementById('admin-total-commission-val');
      if (adminTotalCommission) adminTotalCommission.innerText = `$${commissionTotal.toFixed(2)}`;
      
      // Print new audit logs into CLI console
      if (logs.length > 0) {
        const reversedLogs = [...logs].reverse();
        const newLogs = reversedLogs.slice(auditLogsOffset);
        
        newLogs.forEach(log => {
          let text = `[Audit] ${log.action} | Actor: ${log.actor} | Entity: ${log.entityType}:${log.entityId}`;
          
          if (log.action === 'INVENTORY_DEDUCT') {
            text = `[DB Update] Product stock reduced from ${log.beforeState.stock} to ${log.afterState.stock} (Version incremented ${log.beforeState.version} -> ${log.afterState.version})`;
            logToLedger('db', text);
          } else if (log.action === 'BALANCE_DEDUCT') {
            text = `[DB Update] Buyer balance debited from $${log.beforeState.balance.toFixed(2)} to $${log.afterState.balance.toFixed(2)}`;
            logToLedger('db', text);
          } else if (log.action === 'ESCROW_PAYOUT_MERCHANT') {
            text = `[Escrow Release] Merchant balance credited from $${log.beforeState.balance.toFixed(2)} to $${log.afterState.balance.toFixed(2)} (Escrow payout released)`;
            logToLedger('sys', text);
          } else if (log.action === 'PRODUCT_DELETE_ADMIN') {
            text = `[Audit Moderation] Admin purged listing ID ${log.entityId} from catalog. DB status marked deleted.`;
            logToLedger('err', text);
          } else {
            logToLedger('sys', text);
          }
        });
        
        auditLogsOffset = logs.length;
      }
    }
  } catch (err) {
    console.error(err);
  }
}

// Onboarding wizard handlers
function openOnboarding() {
  document.getElementById('onboard-modal-overlay').classList.add('active');
  document.getElementById('onboard-modal').classList.add('active');
  
  // Reset forms
  document.getElementById('onboard-username').value = '';
  document.getElementById('onboard-fullname').value = '';
  document.getElementById('onboard-password').value = '';
  document.getElementById('onboard-role').value = 'buyer';
  document.getElementById('onboard-funds').value = '10000';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';

  toggleOnboardMode('signup');
}

function closeOnboarding() {
  document.getElementById('onboard-modal-overlay').classList.remove('active');
  document.getElementById('onboard-modal').classList.remove('active');
}

function toggleOnboardMode(mode) {
  const isSignup = mode === 'signup';
  
  document.getElementById('onboard-tab-signup').classList.toggle('active', isSignup);
  document.getElementById('onboard-tab-login').classList.toggle('active', !isSignup);
  
  document.getElementById('onboard-steps-bar').style.display = isSignup ? 'flex' : 'none';
  document.getElementById('onboard-signup-flow-wrapper').style.display = isSignup ? 'block' : 'none';
  document.getElementById('onboard-login-flow-wrapper').style.display = isSignup ? 'none' : 'block';
  
  document.getElementById('onboard-modal-title').innerText = isSignup ? 'Join AURA Network' : 'Authenticate Portal';
  
  if (isSignup) {
    onboardGoToStep(1);
  }
}

function onboardGoToStep(step) {
  const steps = [1, 2, 3];
  steps.forEach(s => {
    document.getElementById(`onboard-step-${s}`).classList.toggle('active', s === step);
    const indicator = document.getElementById(`onboard-step-${s}-indicator`);
    if (indicator) indicator.classList.toggle('active', s === step);
  });
}

async function submitOnboarding() {
  const username = document.getElementById('onboard-username').value.trim();
  const name = document.getElementById('onboard-fullname').value.trim();
  const password = document.getElementById('onboard-password').value;
  const role = document.getElementById('onboard-role').value;
  const balance = parseFloat(document.getElementById('onboard-funds').value);

  if (!username || !name || !password) {
    alert('Please fill out all credentials: Username, Display Name, and Password.');
    onboardGoToStep(1);
    return;
  }

  try {
    const result = await apiRequest('/users/onboard', {
      method: 'POST',
      body: JSON.stringify({
        id: username,
        name,
        password,
        role,
        balance
      })
    });

    const user = result.data.user;
    
    alert(`Account "${user.id}" registered successfully! Please log in with your credentials.`);
    
    // Automatically switch to login mode and pre-fill username
    toggleOnboardMode('login');
    document.getElementById('login-username').value = user.id;
    document.getElementById('login-password').focus();

  } catch (err) {
    alert(`Registration failed: ${err.message}`);
    onboardGoToStep(1);
  }
}

async function submitLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    alert('Please enter your Username and Password.');
    return;
  }

  try {
    const result = await apiRequest('/users/login', {
      method: 'POST',
      body: JSON.stringify({
        id: username,
        password
      })
    });

    const user = result.data.user;

    // Save session context to localStorage
    localStorage.setItem('aura_session', JSON.stringify(user));
    
    currentPersonaId = user.id;
    currentPersonaRole = user.role;

    // Display profile details in header
    showUserProfile(user);

    // Enable close button on auth modal
    const closeBtn = document.getElementById('onboard-close-btn');
    if (closeBtn) closeBtn.style.display = 'block';

    // Update navigation dashboards separation (RBAC)
    updateNavigationTabs();
    
    // Load datasets
    loadCatalogData();
    pollSystemUpdates();

    closeOnboarding();
    alert(`Authenticated! Welcome back, ${user.name}.`);

  } catch (err) {
    alert(`Authentication failed: ${err.message}`);
  }
}

// Legal modal triggers
async function openPolicy(policy) {
  document.getElementById('policy-modal-overlay').classList.add('active');
  document.getElementById('policy-modal').classList.add('active');
  await fetchPolicy(policy);
}

function closePolicy() {
  document.getElementById('policy-modal-overlay').classList.remove('active');
  document.getElementById('policy-modal').classList.remove('active');
}

async function fetchPolicy(policy) {
  const tabBtns = document.querySelectorAll('.policy-tab-btn');
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.id === `policy-tab-${policy}`);
  });
  
  const contentArea = document.getElementById('policy-content-area');
  contentArea.innerHTML = `
    <div style="text-align: center; padding: 3rem 0;">
      <div class="spinner-ring" style="margin: 0 auto 1.5rem auto;"></div>
      <p>Reading secure legal ledger...</p>
    </div>
  `;
  
  try {
    const result = await apiRequest(`/policies/${policy}`);
    document.getElementById('policy-title').innerText = getPolicyTitle(policy);
    
    contentArea.innerHTML = parseMarkdown(result.data.content);
  } catch (err) {
    contentArea.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--error);">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 1rem;"></i>
        <p>Failed to load agreement: ${err.message}</p>
      </div>
    `;
  }
}

function getPolicyTitle(policy) {
  switch (policy) {
    case 'TOS': return 'Terms of Service';
    case 'PRIVACY': return 'Privacy Policy';
    case 'DPA': return 'Data Processing Agreement';
    case 'REFUND': return 'Refund Policy';
    case 'MSA': return 'Master Service Agreement';
    default: return 'Legal Documentation';
  }
}

// Simple regex markdown parsing
function parseMarkdown(md) {
  let html = md;
  
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^- (.*?)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(p => {
    if (p.trim().startsWith('<h') || p.trim().startsWith('<hr') || p.trim().startsWith('<ul') || p.trim().startsWith('<ul>')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
  
  return html;
}

// Escape HTML utility
function escapeHtml(string) {
  return String(string).replace(/[&<>"']/g, function (s) {
    switch (s) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return s;
    }
  });
}
