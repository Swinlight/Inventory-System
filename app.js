function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function escapeHtml(s) {
  if (s === null || s === undefined || s === "") return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function statusClass(s) {
  return "st-" + String(s || "").toLowerCase().replace(/\s+/g, "-");
}
function peso(n) {
  if (n === null || n === undefined || n === "") return "₱0.00";
  return "₱" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Settings for each device type / page */
const PAGES = {
  Laptop: { key: "laptops", one: "laptop", many: "laptops", icon: "💻" },
  Phone:  { key: "phones",  one: "phone",  many: "phones",  icon: "📱" },
  DJI:    { key: "others",  one: "device", many: "devices", icon: "📹" }
};
function iconFor(type) { return (PAGES[type] && PAGES[type].icon) || "📦"; }

/* Sort by asset tag in natural order: 1, 2, 3 ... 10 */
function byTag(a, b) {
  const ta = a.assetTag || "", tb = b.assetTag || "";
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  const c = ta.localeCompare(tb, undefined, { numeric: true, sensitivity: "base" });
  if (c !== 0) return c;
  return (a.assetName || "").localeCompare(b.assetName || "", undefined, { numeric: true });
}

/* ---------- Data layer (Supabase) ---------- */
async function fetchItems() {
  const { data, error } = await supabaseClient.from("devices").select("*");
  if (error) { console.error("Fetch failed", error); return []; }
  return (data || []).map(r => ({
    id: r.id,
    assetName: r.asset_name,
    type: r.type,
    assetTag: r.asset_tag,
    holder: r.holder,
    serial: r.serial,
    previousHolders: r.previous_holders,
    dateGiven: r.date_given,
    dateReturned: r.date_returned,
    purchaseDate: r.purchase_date,
    purchaseAmount: r.purchase_amount,
    status: r.status,
    stock: r.stock,
    defective: r.defective,
    forRepair: r.for_repair,
    warrantyExpired: r.warranty_expired,
    notes: r.notes,
    updatedAt: r.updated_at
  }));
}

async function upsertItem(it) {
  const row = {
    id: it.id,
    asset_name: it.assetName,
    type: it.type,
    asset_tag: it.assetTag,
    holder: it.holder,
    serial: it.serial,
    previous_holders: it.previousHolders,
    date_given: it.dateGiven,
    date_returned: it.dateReturned,
    purchase_date: it.purchaseDate,
    purchase_amount: it.purchaseAmount,
    status: it.status,
    stock: it.stock,
    defective: it.defective,
    for_repair: it.forRepair,
    warranty_expired: it.warrantyExpired,
    notes: it.notes,
    updated_at: it.updatedAt
  };
  const { error } = await supabaseClient.from("devices").upsert(row);
  if (error) { console.error("Save failed", error); alert("Could not save: " + error.message); return false; }
  return true;
}

async function deleteItemRemote(id) {
  const { error } = await supabaseClient.from("devices").delete().eq("id", id);
  if (error) { console.error("Delete failed", error); alert("Could not delete: " + error.message); return false; }
  return true;
}

/* Realtime: any add/edit/delete by anyone updates every open page, no refresh */
function subscribeRealtime(onChange) {
  let timer = null;
  supabaseClient
    .channel("devices-" + Math.random().toString(36).slice(2))
    .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 150);
    })
    .subscribe();
}

/* One category per device so dashboard numbers always add up */
function category(it) {
  if (it.status === "Retired") return "Retired";
  if (it.forRepair === "Yes" || it.status === "Repair") return "Repair";
  if (it.defective === "Yes" || it.status === "Defective") return "Defective";
  if (it.status === "Assigned") return "Assigned";
  return "Available";
}

/* ---------- Sidebar ---------- */
function paintSidebar(active, items) {
  const el = document.getElementById("sidebar");
  if (!el) return;
  const n = t => items.filter(i => i.type === t).length;
  const link = (href, label, count, key) =>
    `<a href="${href}" class="${active === key ? "active" : ""}"><span>${label}</span>${count !== null ? `<span class="count">${count}</span>` : ""}</a>`;
  el.innerHTML = `
    <div class="brand">Inventory</div>
    <div class="ws"><span class="dot"></span> Asset Inventory</div>
    ${link("index.html", "Overview", null, "overview")}
    ${link("laptops.html", "Laptops", n("Laptop"), "laptops")}
    ${link("phones.html", "Phones", n("Phone"), "phones")}
    ${link("others.html", "Others", n("Others"), "others")}
  `;
}

/* Compatibility: older index.html files call renderSidebar("overview") */
function renderSidebar(active) { paintSidebar(active, []); }

/* ---------- Home dashboard ---------- */
let homeItems = [];

function paintHome() {
  const items = homeItems;
  const count = c => items.filter(i => category(i) === c).length;
  const total = items.length;
  const inUse = count("Assigned");
  const available = count("Available");
  const repair = count("Repair");
  const defective = count("Defective");
  const retired = count("Retired");
  const totalValue = items.reduce((s, i) => s + (Number(i.purchaseAmount) || 0), 0);

  const laptopCount = items.filter(i => i.type === "Laptop").length;
  const phoneCount = items.filter(i => i.type === "Phone").length;
  const djiCount = items.filter(i => i.type === "DJI").length;

  const dateEl = document.getElementById("todayDate");
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).toUpperCase();

  const statCard = (icon, iconClass, label, n, sub, href) => {
    const inner = `
      <div class="stat-top">
        <span class="stat-icon ${iconClass}">${icon}</span>
        <span class="card-l">${label}</span>
      </div>
      <div class="card-n">${n}</div>
      <div class="card-sub">${sub}</div>`;
    return href
      ? `<a href="${href}" class="card card-link">${inner}</a>`
      : `<div class="card">${inner}</div>`;
  };

  document.getElementById("cardgrid").innerHTML = `
    <div class="group-label">Assets by type</div>
    <div class="cardrow">
      ${statCard("📦", "ic-total", "Total assets", total, "Laptops, phones and DJI")}
      ${statCard("💻", "ic-assigned", "Laptops", laptopCount, "View all →", "laptops.html")}
      ${statCard("📱", "ic-stock", "Phones", phoneCount, "View all →", "phones.html")}
      ${statCard("🚁", "ic-repair", "Others (DJI)", djiCount, "View all →", "others.html")}
    </div>

    <div class="group-label">Status</div>
    <div class="cardrow">
      ${statCard("✅", "ic-assigned", "In use", inUse, `${total ? Math.round(inUse / total * 100) : 0}% of inventory`)}
      ${statCard("🟢", "ic-stock", "Available", available, "Ready to assign")}
      ${statCard("🛠️", "ic-repair", "For repair", repair, "Currently being repaired")}
      ${statCard("⚠️", "ic-defective", "Defective", defective, "Needs attention")}
      ${statCard("📴", "ic-retired", "Retired", retired, "Removed from service")}
      ${statCard("₱", "ic-total", "Total value", peso(totalValue), "Recorded purchases")}
    </div>
  `;

  const segs = [
    ["In use", inUse, "var(--assigned)"],
    ["Available", available, "var(--stock)"],
    ["For repair", repair, "var(--repair)"],
    ["Defective", defective, "var(--defective)"],
    ["Retired", retired, "var(--retired)"]
  ];
  let acc = 0;
  const gradParts = segs.filter(s => s[1] > 0).map(([, n, color]) => {
    const start = acc / total * 360;
    acc += n;
    const end = acc / total * 360;
    return `${color} ${start}deg ${end}deg`;
  });
  document.getElementById("donut").style.background = total ? `conic-gradient(${gradParts.join(",")})` : "var(--border)";
  document.getElementById("donutTotal").textContent = total;
  document.getElementById("legend").innerHTML = segs.map(([label, n, color]) =>
    `<div><span class="sw" style="background:${color}"></span><span class="lbl">${label}</span><span class="val">${n}</span></div>`).join("");

  const recent = items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
  document.getElementById("activity").innerHTML = recent.length ? recent.map(it =>
    `<div class="activity-item"><span class="ic">${iconFor(it.type)}</span><span><b>${escapeHtml(it.assetName)}</b> updated</span><span class="when">${timeAgo(it.updatedAt)}</span></div>`
  ).join("") : `<div class="empty">No activity yet.</div>`;

  paintRecentTable();
}
function currentTab() {
  return document.querySelector(".tabs-pill button.active")?.dataset.filter || "All";
}

function paintRecentTable() {
  const q = (document.getElementById("homeSearch")?.value || "").toLowerCase();
  const filter = currentTab();
  let rows = homeItems.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (filter === "In use") rows = rows.filter(i => category(i) === "Assigned");
  if (filter === "Available") rows = rows.filter(i => category(i) === "Available");
  if (q) rows = rows.filter(i => [i.assetName, i.holder, i.serial, i.assetTag].join(" ").toLowerCase().includes(q));
  rows = rows.slice(0, 8);
  const tbody = document.getElementById("recentBody");
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map(it => `
    <tr>
      <td>${iconFor(it.type)} ${escapeHtml(it.assetName)}</td>
      <td>${escapeHtml(it.type)}</td>
      <td>${escapeHtml(it.holder) || "—"}</td>
      <td><span class="badge ${statusClass(it.status)}">${escapeHtml(it.status) || "—"}</span></td>
      <td>${timeAgo(it.updatedAt)}</td>
    </tr>`).join("") : `<tr><td colspan="5" class="empty">No devices yet.</td></tr>`;
}

async function renderHome() {
  paintSidebar("overview", []); // show the menu right away

  document.querySelectorAll(".tabs-pill button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabs-pill button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    paintRecentTable();
  });
  const searchEl = document.getElementById("homeSearch");
  if (searchEl) searchEl.oninput = paintRecentTable;

  async function load() {
    try {
      homeItems = await fetchItems();
      paintSidebar("overview", homeItems);
      paintHome();
    } catch (e) {
      console.error("Dashboard error:", e);
    }
  }
  await load();
  subscribeRealtime(load);
}

function timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

/* ---------- Inventory list page (laptops / phones / others) ---------- */
async function initInventoryPage(deviceType) {
  let items = [];
  let editingId = null;
  const page = PAGES[deviceType] || { key: deviceType.toLowerCase(), one: deviceType.toLowerCase(), many: deviceType.toLowerCase() + "s" };
  const $ = id => document.getElementById(id);

  paintSidebar(page.key, []); // show the menu right away

  function typeItems() { return items.filter(i => i.type === deviceType); }

  function render() {
    paintSidebar(page.key, items);
    const q = $("search").value.toLowerCase();
    const fs = $("filterStatus").value;
    const filtered = typeItems().filter(it => {
      if (fs && it.status !== fs) return false;
      if (q) {
        const hay = [it.assetName, it.assetTag, it.holder, it.previousHolders, it.serial].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort(byTag);

    $("table").style.display = filtered.length ? "table" : "none";
    $("empty").style.display = filtered.length ? "none" : "block";
    $("empty").textContent = typeItems().length
      ? "No devices match your search."
      : `No ${page.many} yet. Add your first one to get started.`;

    $("tbody").innerHTML = filtered.map(it => `
      <tr>
        <td><b>${escapeHtml(it.assetName) || "—"}</b></td>
        <td>${escapeHtml(it.type)}</td>
        <td class="mono">${escapeHtml(it.assetTag) || "—"}</td>
        <td>${escapeHtml(it.holder) || "—"}</td>
        <td class="mono">${escapeHtml(it.serial) || "—"}</td>
        <td>${escapeHtml(it.previousHolders) || "—"}</td>
        <td><span class="badge ${statusClass(it.status)}">${escapeHtml(it.status) || "—"}</span></td>
        <td class="row-actions"><button data-edit="${it.id}">Edit</button><button data-del="${it.id}">Delete</button></td>
      </tr>`).join("");
  }

  async function reload() {
    items = await fetchItems();
    render();
  }

  function openModal(item) {
    editingId = item ? item.id : null;
    $("modalTitle").textContent = item ? "Edit asset" : `Add ${page.one}`;
    $("f_assetName").classList.remove("invalid");
    $("f_assetName").value = item?.assetName || "";
    $("f_type").value = item?.type || deviceType;
    $("f_assetTag").value = item?.assetTag || "";
    $("f_holder").value = item?.holder || "";
    $("f_previousHolders").value = item?.previousHolders || "";
    $("f_dateGiven").value = item?.dateGiven || "";
    $("f_dateReturned").value = item?.dateReturned || "";
    $("f_purchaseDate").value = item?.purchaseDate || "";
    $("f_purchaseAmount").value = item?.purchaseAmount ?? "";
    $("f_status").value = item?.status || "Available";
    $("f_stock").value = item?.stock || "In stock";
    $("f_defective").value = item?.defective || "No";
    $("f_forRepair").value = item?.forRepair || "No";
    $("f_warrantyExpired").value = item?.warrantyExpired || "No";
    $("f_notes").value = item?.notes || "";
    $("f_serial").value = item?.serial || "";
    $("modalBg").classList.add("open");
    $("f_assetName").focus();
  }
  function closeModal() { $("modalBg").classList.remove("open"); }

  $("addBtn").onclick = () => openModal(null);
  $("cancelBtn").onclick = closeModal;
  $("modalBg").onclick = e => { if (e.target.id === "modalBg") closeModal(); };

  $("saveBtn").onclick = async () => {
    const assetName = $("f_assetName").value.trim();
    if (!assetName) {
      $("f_assetName").classList.add("invalid");
      $("f_assetName").focus();
      return;
    }
    const amount = $("f_purchaseAmount").value;
    const item = {
      id: editingId || uid(),
      assetName,
      type: $("f_type").value,
      assetTag: $("f_assetTag").value.trim(),
      holder: $("f_holder").value.trim(),
      previousHolders: $("f_previousHolders").value.trim(),
      serial: $("f_serial").value.trim(),
      dateGiven: $("f_dateGiven").value,
      dateReturned: $("f_dateReturned").value,
      purchaseDate: $("f_purchaseDate").value,
      purchaseAmount: amount === "" ? null : Number(amount),
      status: $("f_status").value,
      stock: $("f_stock").value,
      defective: $("f_defective").value,
      forRepair: $("f_forRepair").value,
      warrantyExpired: $("f_warrantyExpired").value,
      notes: $("f_notes").value.trim(),
      updatedAt: Date.now()
    };

    // Update the screen immediately, then save to the database
    const idx = items.findIndex(i => i.id === item.id);
    if (idx > -1) items[idx] = item; else items.push(item);
    render();
    closeModal();

    $("saveBtn").disabled = true;
    const ok = await upsertItem(item);
    $("saveBtn").disabled = false;
    if (!ok) await reload();
  };

  $("tbody").addEventListener("click", async e => {
    const editId = e.target.getAttribute("data-edit");
    const delId = e.target.getAttribute("data-del");
    if (editId) openModal(items.find(i => i.id === editId));
    if (delId && confirm("Delete this asset?")) {
      items = items.filter(i => i.id !== delId); // gone from screen instantly
      render();
      const ok = await deleteItemRemote(delId);
      if (!ok) await reload();
    }
  });

  ["search", "filterStatus"].forEach(id => $(id).addEventListener("input", render));

  await reload();
  subscribeRealtime(reload);
}
