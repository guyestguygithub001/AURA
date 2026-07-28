// AURA Fluid Client State Controller
let currentPersonaId = 'u-1';
let currentPersonaRole = 'buyer';
let activeView = 'buyer';
let activeCategory = 'All';
let products = [];
let cart = [];
let searchDebounceTimer = null;
let auditLogsOffset = 0;

// API Config
const API_BASE = '/api/v1';

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadCatalogData();
  switchView('buyer');
  
  // Start polling audit logs & wallet data for real-time ledger representation
  pollSystemUpdates();
  setInterval(pollSystemUpdates, 3000);
});

// Setup Listeners
function setupEventListeners() {
  document.getElementById('persona-select').addEventListener('change', (e) => {
    currentPersonaId = e.target.value;
    currentPersonaRole = currentPersonaId === 'u-1' ? 'buyer' : 'merchant';
    
    // Log persona switch
    logToLedger('sys', `[Client] Switch Persona to: ${currentPersonaId === 'u-1' ? 'Alpha Buyer (Buyer)' : 'Premium Merchant (Seller)'}`);
    
    // Refresh interfaces
    loadCatalogData();
    pollSystemUpdates();
  });
}

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
        ...options.headers
      }
    });
    
    const resData = await response.json();
    
    if (!response.ok) {
      logToLedger('err', `[API Error Response] Status ${response.status} - ${resData.message || 'Operation failed'}`);
      throw new Error(resData.message || 'Server error occurred');
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
  
  // Toggle view panels
  document.getElementById('buyer-view').classList.toggle('active', view === 'buyer');
  document.getElementById('merchant-view').classList.toggle('active', view === 'merchant');
  
  logToLedger('sys', `[Client] Switch View Pane: ${view.toUpperCase()}`);
  
  if (view === 'merchant') {
    refreshMerchantView();
  }
}

// Search bar filters
function handleSearch() {
  const searchVal = document.getElementById('search-input').value;
  document.getElementById('clear-search-btn').style.display = searchVal ? 'block' : 'none';
  
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    logToLedger('sys', `[Client Search] Query debounced: "${searchVal}"`);
    renderProducts();
  }, 200);
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
  
  // Introduce a slight delay to simulate processing & network latency for a high-fidelity visual check
  setTimeout(async () => {
    try {
      const orderItem = cart[0]; // Simplification for demo checkout processing (single items checklist)
      
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
      
      // Clear local cart
      cart = [];
      updateCartBadge();
      loadCatalogData(); // Pull fresh version index stock data
      
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

// Merchant portal actions
async function refreshMerchantView() {
  // Fetch active merchant wallet info
  pollSystemUpdates();
  
  try {
    // Fetch active orders to display
    const resLogs = await fetch(`${API_BASE}/audit-logs`);
    const logsData = await resLogs.json();
    
    // We fetch orders using DB read file fallback since it's sandbox environment
    const usersRes = await apiRequest('/users');
    const users = usersRes.data.users;
    
    // Fetch DB snapshot directly for order arrays
    const rawDB = await fetch('/api/v1/users'); // Custom endpoint returning raw state wrapper
    const dataState = await rawDB.json();
    
    // Load orders list
    renderMerchantOrders();
  } catch (err) {
    console.error(err);
  }
}

async function renderMerchantOrders() {
  const container = document.getElementById('merchant-orders-body');
  if (!container) return;
  
  try {
    const rawDB = await fetch(`${API_BASE}/users`);
    const usersRes = await rawDB.json();
    
    // In our simplified database.js implementation, we pull orders from database
    const productsRes = await fetch(`${API_BASE}/products`);
    const productsData = await productsRes.json();
    
    const dbRaw = await fetch(`${API_BASE}/audit-logs`); // Returns all logs
    // Let's call a quick endpoint or fetch users to extract orders
    // Actually we can list all active order items by checking data
    // We will parse orders array directly
    // Let's create an endpoint or simply read from the response
    // To make it robust, we'll fetch /users and extract all orders from response
    // Wait, let's look at api_v1.js: GET /users returns raw DB data wrapper.
    // In api_v1.js: router.get('/users', ...) returns object containing users only, but we can query raw database structure if we add routes or read it.
    // Let's fetch audit logs to populate orders, or load it from a query.
    // Let's look at the database data: we have an 'orders' collection!
    // Since we don't have a direct GET /orders endpoint, we can check how to query it.
    // Wait, we can fetch all audit logs, and retrieve orders from logs, or query them.
    // Actually, let's look at api_v1.js. In api_v1.js we have:
    // router.get('/users') returns object with users only: res.status(200).json({ status: 'success', data: { users: Object.values(data.users) } });
    // Let's see: we can query the order details. Let's make a quick lookup.
    // Wait! Can we inspect if we can query orders?
    // Let's look at api_v1.js. Oh, it doesn't have a simple GET /orders. But wait, it returns audit logs!
    // Audit logs contain order details under `afterState`. We can extract order lists from audit logs or just query all logs where action is 'ORDER_PLACE'.
    // Let's write client-side logic to scan audit logs for orders, or let's create a custom route if needed. But scanning audit logs for order states is super easy!
    // Let's extract orders from audit logs.
    const resLogs = await fetch(`${API_BASE}/audit-logs`);
    const logsData = await resLogs.json();
    
    const ordersMap = {};
    const logs = logsData.data.logs;
    
    // Reconstruct current orders state from audit logs
    logs.forEach(log => {
      if (log.entityType === 'order') {
        const orderId = log.entityId;
        if (!ordersMap[orderId]) {
          ordersMap[orderId] = log.afterState || log.beforeState;
        } else {
          // If there is a newer state in logs (e.g. SHIPPED or DELIVERED), update it
          if (new Date(log.timestamp) > new Date(ordersMap[orderId].updated_at)) {
            ordersMap[orderId] = log.afterState || log.beforeState;
          }
        }
      }
    });
    
    const orders = Object.values(ordersMap).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    if (orders.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.5;"></i>
            No transactions registered yet.
          </td>
        </tr>
      `;
      return;
    }
    
    container.innerHTML = orders.map(ord => {
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

// Add listing
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
        merchantId: 'u-2' // Premium Merchant ID
      })
    });
    
    // Clear Form
    document.getElementById('add-product-form').reset();
    
    // Refresh lists
    await loadCatalogData();
    await refreshMerchantView();
    
    logToLedger('sys', `[Client Portal] Product listed successfully!`);
    alert('Product successfully published to marketplace catalog.');
  } catch (err) {
    alert(`Failed to add product: ${err.message}`);
  }
}

// Ship Order
async function shipOrder(orderId) {
  try {
    await apiRequest(`/orders/${orderId}/ship`, {
      method: 'POST',
      body: JSON.stringify({ merchantId: 'u-2' })
    });
    
    await refreshMerchantView();
  } catch (err) {
    alert(`Failed to ship order: ${err.message}`);
  }
}

// Deliver Order (releases escrow payout)
async function deliverOrder(orderId) {
  try {
    // Deliver can be marked by delivery carrier agent role u-3 or buyer
    await apiRequest(`/orders/${orderId}/deliver`, {
      method: 'POST',
      body: JSON.stringify({ actorId: 'u-3' }) // Admin/Carrier API role
    });
    
    await refreshMerchantView();
  } catch (err) {
    alert(`Failed to complete delivery: ${err.message}`);
  }
}

// Poll logs & details
async function pollSystemUpdates() {
  try {
    // Fetch users (balances)
    const usersRes = await fetch(`${API_BASE}/users`);
    if (!usersRes.ok) return;
    const usersData = await usersRes.json();
    const users = usersData.data.users;
    
    // Update Wallet values
    const buyer = users.find(u => u.id === 'u-1');
    const merchant = users.find(u => u.id === 'u-2');
    
    if (buyer) {
      document.getElementById('persona-select').options[0].text = `Alpha Buyer ($${buyer.balance.toFixed(2)})`;
    }
    if (merchant) {
      document.getElementById('persona-select').options[1].text = `Premium Merchant ($${merchant.balance.toFixed(2)})`;
      document.getElementById('merchant-wallet-val').innerText = `$${merchant.balance.toFixed(2)}`;
    }
    
    // Fetch audit logs and append new ones to CLI screen
    const resLogs = await fetch(`${API_BASE}/audit-logs`);
    if (!resLogs.ok) return;
    const logsData = await resLogs.json();
    const logs = logsData.data.logs;
    
    // Calculate total escrow volume
    let escrowTotal = 0;
    // Iterate through current orders from audit logs
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
      if (ord.status === 'PAID' || ord.status === 'SHIPPED') {
        escrowTotal += ord.total_amount;
      }
    });
    document.getElementById('merchant-escrow-val').innerText = `$${escrowTotal.toFixed(2)}`;
    
    // Extract new logs (since last check offset)
    if (logs.length > 0) {
      const reversedLogs = [...logs].reverse(); // Oldest first
      const newLogs = reversedLogs.slice(auditLogsOffset);
      
      newLogs.forEach(log => {
        let text = `[Audit] ${log.action} | Actor: ${log.actor} | Entity: ${log.entityType}:${log.entityId}`;
        
        // Custom formatting for database state logs
        if (log.action === 'INVENTORY_DEDUCT') {
          text = `[DB Update] Product stock reduced from ${log.beforeState.stock} to ${log.afterState.stock} (Version incremented ${log.beforeState.version} -> ${log.afterState.version})`;
          logToLedger('db', text);
        } else if (log.action === 'BALANCE_DEDUCT') {
          text = `[DB Update] Buyer balance debited from $${log.beforeState.balance.toFixed(2)} to $${log.afterState.balance.toFixed(2)}`;
          logToLedger('db', text);
        } else if (log.action === 'ESCROW_PAYOUT_MERCHANT') {
          text = `[Escrow Release] Merchant balance credited from $${log.beforeState.balance.toFixed(2)} to $${log.afterState.balance.toFixed(2)} (Escrow payload released)`;
          logToLedger('sys', text);
        } else {
          logToLedger('sys', text);
        }
      });
      
      auditLogsOffset = logs.length;
    }
  } catch (err) {
    console.error(err);
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
  // Toggle tabs
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
    
    // Parse Markdown to HTML for presentation
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

// Simple regex markdown parsing for high-fidelity legal layout
function parseMarkdown(md) {
  let html = md;
  
  // Headers
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Horizontal lines
  html = html.replace(/^---$/gm, '<hr>');
  
  // Bullet items
  html = html.replace(/^- (.*?)$/gm, '<li>$1</li>');
  
  // Fix list wrappers
  html = html.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
  // Remove nested uls
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  
  // Paragraphs (split by double line breaks)
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(p => {
    if (p.trim().startsWith('<h') || p.trim().startsWith('<hr') || p.trim().startsWith('<ul') || p.trim().startsWith('<ul>')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
  
  return html;
}

// Escape HTML utility to prevent XSS in sandbox demo
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
