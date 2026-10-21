
"use strict";

/* =========================================
   KONFIGURASI
========================================= */

// Ganti dengan URL Google Apps Script berakhiran /exec.
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxxSVDY5X0aX4TA2S9j7NVqq4WX6ni8dsokgI54a7itdy3G8fSch-a4EdGmahFywZ7F2w/exec";

// Tanggal acara dalam zona waktu WIB.
const WEDDING_DATE = new Date("2026-11-21T08:00:00+07:00");

const $ = (id) => document.getElementById(id);

let allWishes = [];
let visibleWishes = 6;
let isSending = false;
let refreshTimer = null;
let requestCounter = 0;

// =========================================
// NAMA TAMU DARI TAUTAN
// Contoh: undangan.example/?to=Budi%20Santoso
// =========================================

const urlParams = new URLSearchParams(window.location.search);
const guestFromUrl = (urlParams.get("to") || "")
  .replace(/[<>]/g, "")
  .trim()
  .slice(0, 100);

if (guestFromUrl && $("guestName")) {
  $("guestName").textContent = guestFromUrl;
}

if (guestFromUrl && $("name")) {
  $("name").value = guestFromUrl;
}

// =========================================
// BUKA UNDANGAN
// =========================================

$("openInvitation")?.addEventListener("click", async () => {
  $("cover").hidden = true;
  $("mainContent").hidden = false;

  loadWishes();
  startWishesRefresh();

  // Musik hanya dicoba setelah interaksi pengguna.
  const music = $("backgroundMusic");

  if (music) {
    try {
      await music.play();
      updateMusicButton();
    } catch (error) {
      // Undangan tetap bisa dibuka tanpa musik.
    }
  }
});

// =========================================
// COUNTDOWN
// =========================================

function updateCountdown() {
  let remaining = Math.max(0, WEDDING_DATE.getTime() - Date.now());

  const days = Math.floor(remaining / 86400000);
  remaining %= 86400000;

  const hours = Math.floor(remaining / 3600000);
  remaining %= 3600000;

  const minutes = Math.floor(remaining / 60000);
  remaining %= 60000;

  const seconds = Math.floor(remaining / 1000);

  const values = { days, hours, minutes, seconds };

  for (const [id, value] of Object.entries(values)) {
    const element = $(id);
    if (element) {
      element.textContent = String(value).padStart(2, "0");
    }
  }
}

updateCountdown();
setInterval(updateCountdown, 1000);

// =========================================
// HELPER STATUS
// =========================================

function showStatus(element, message, isError = false) {
  if (!element) return;

  element.textContent = message;
  element.classList.toggle("error", isError);
}

// =========================================
// RSVP KE GOOGLE SHEETS
// =========================================

$("rsvpForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSending) return;

  if (
    !GOOGLE_SCRIPT_URL ||
    GOOGLE_SCRIPT_URL.includes("GANTI_DENGAN")
  ) {
    showStatus(
      $("rsvpStatus"),
      "URL Google Apps Script belum dikonfigurasi.",
      true
    );
    return;
  }

  const formData = new FormData(event.currentTarget);

  const payload = {
    name: String(formData.get("name") || "").trim(),
    attendance: String(formData.get("attendance") || ""),
    guestCount: Number(formData.get("guestCount")),
    message: String(formData.get("message") || "").trim()
  };

  if (!payload.name || !payload.attendance) {
    showStatus($("rsvpStatus"), "Lengkapi nama dan kehadiran.", true);
    return;
  }

  if (payload.name.length > 100 || payload.message.length > 1000) {
    showStatus($("rsvpStatus"), "Periksa panjang nama dan ucapan.", true);
    return;
  }

  const button = $("submitRsvp");
  isSending = true;

  if (button) button.disabled = true;

  showStatus($("rsvpStatus"), "Mengirim konfirmasi...", false);

  try {
    /*
      Apps Script akan menerima POST.
      Karena mode no-cors tidak mengizinkan browser membaca
      respons, keberhasilan diverifikasi dengan membaca
      ulang data melalui endpoint JSONP.
    */
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    showStatus(
      $("rsvpStatus"),
      "Permintaan dikirim. Sedang memeriksa penyimpanan...",
      false
    );

    let saved = false;

    // Coba membaca ulang spreadsheet beberapa kali.
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(1500);

      const loaded = await loadWishes();

      if (loaded) {
        saved = allWishes.some((item) =>
          item.name === payload.name &&
          item.attendance === payload.attendance &&
          Number(item.guestCount) === payload.guestCount &&
          item.message === payload.message
        );

        if (saved) break;
      }
    }

    if (saved) {
      showStatus(
        $("rsvpStatus"),
        "Terima kasih! RSVP dan ucapan telah tersimpan.",
        false
      );

      event.currentTarget.reset();

      // Pertahankan nama tamu dari tautan undangan.
      if (guestFromUrl && $("name")) {
        $("name").value = guestFromUrl;
      }

      $("wishes")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    } else {
      showStatus(
        $("rsvpStatus"),
        "Data belum dapat diverifikasi. Periksa deployment, izin akses, dan Google Sheets sebelum mencoba kembali.",
        true
      );
    }
  } catch (error) {
    showStatus(
      $("rsvpStatus"),
      "Gagal mengirim. Periksa koneksi internet dan URL Apps Script.",
      true
    );
  } finally {
    isSending = false;
    if (button) button.disabled = false;
  }
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =========================================
// MEMBACA UCAPAN DARI GOOGLE SHEETS
// JSONP digunakan untuk menghindari pembatasan
// CORS pada pembacaan data.
 // =========================================

function loadWishes() {
  return new Promise((resolve) => {
    if (
      !GOOGLE_SCRIPT_URL ||
      GOOGLE_SCRIPT_URL.includes("GANTI_DENGAN")
    ) {
      showStatus(
        $("wishesLoading"),
        "Hubungkan Google Apps Script untuk menampilkan ucapan.",
        true
      );
      resolve(false);
      return;
    }

    let endpoint;

    try {
      endpoint = new URL(GOOGLE_SCRIPT_URL);
    } catch {
      showStatus(
        $("wishesLoading"),
        "URL Apps Script tidak valid.",
        true
      );
      resolve(false);
      return;
    }

    const callbackName =
      "__weddingCallback" + (++requestCounter);

    endpoint.searchParams.set("action", "messages");
    endpoint.searchParams.set("callback", callbackName);
    endpoint.searchParams.set("_", String(Date.now()));

    const script = document.createElement("script");
    script.async = true;

    let finished = false;

    const timeoutId = setTimeout(() => {
      finish(false);
      showStatus(
        $("wishesLoading"),
        "Waktu pemuatan habis. Periksa URL dan akses Web app.",
        true
      );
    }, 12000);

    function finish(success) {
      if (finished) return;
      finished = true;

      clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();

      resolve(success);
    }

    window[callbackName] = (data) => {
      if (!data || data.success !== true ||
          !Array.isArray(data.messages)) {
        showStatus(
          $("wishesLoading"),
          "Data ucapan tidak dapat dibaca.",
          true
        );
        finish(false);
        return;
      }

      allWishes = data.messages;
      renderWishes();

      showStatus(
        $("wishesLoading"),
        allWishes.length
          ? `${allWishes.length} ucapan terbaru.`
          : "Belum ada ucapan. Jadilah yang pertama memberikan doa!",
        false
      );

      finish(true);
    };

    script.onerror = () => {
      showStatus(
        $("wishesLoading"),
        "Gagal memuat ucapan dari Google Sheets.",
        true
      );
      finish(false);
    };

    script.src = endpoint.toString();
    document.body.appendChild(script);
  });
}

// =========================================
// MENAMPILKAN UCAPAN
// =========================================

function renderWishes() {
  const list = $("wishesList");
  if (!list) return;

  list.replaceChildren();

  const visibleItems = allWishes.slice(0, visibleWishes);

  for (const item of visibleItems) {
    const card = document.createElement("article");
    card.className = "wish-card";

    const name = document.createElement("h4");
    name.className = "wish-name";
    name.textContent = item.name || "Tamu Undangan";

    const attendance = document.createElement("p");
    attendance.className = "wish-attendance";
    attendance.textContent =
      item.attendance === "Hadir"
        ? "✓ Akan hadir"
        : item.attendance === "Tidak hadir"
          ? "Belum bisa hadir"
          : "Konfirmasi diterima";

    const message = document.createElement("p");
    message.className = "wish-message";
    message.textContent = item.message || "Mengirimkan doa terbaik.";

    const date = document.createElement("small");
    date.className = "wish-date";
    date.textContent = item.date || "";

    card.append(name, attendance, message, date);
    list.appendChild(card);
  }

  if ($("loadMoreWishes")) {
    $("loadMoreWishes").hidden =
      allWishes.length <= visibleWishes;
  }
}

$("loadMoreWishes")?.addEventListener("click", () => {
  visibleWishes += 6;
  renderWishes();
});

// =========================================
// REFRESH UCAPAN SETIAP 20 DETIK
// =========================================

function startWishesRefresh() {
  if (refreshTimer) return;

  refreshTimer = setInterval(() => {
    if (!document.hidden) {
      loadWishes();
    }
  }, 20000);
}

// =========================================
// SALIN NOMOR REKENING
// =========================================

$("copyAccount")?.addEventListener("click", async () => {
  const account = $("accountNumber")?.textContent.trim();

  if (!account) return;

  try {
    await navigator.clipboard.writeText(account);
    showStatus(
      $("copyStatus"),
      "Nomor rekening berhasil disalin.",
      false
    );
  } catch {
    // Fallback untuk browser tanpa Clipboard API.
    const textarea = document.createElement("textarea");
    textarea.value = account;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand("copy");
    textarea.remove();

    showStatus(
      $("copyStatus"),
      copied
        ? "Nomor rekening berhasil disalin."
        : "Silakan salin nomor rekening secara manual.",
      !copied
    );
  }
});

// =========================================
// MUSIK LATAR
// =========================================

function updateMusicButton() {
  const music = $("backgroundMusic");
  const button = $("musicToggle");

  if (!music || !button) return;

  const playing = !music.paused;
  button.textContent = playing ? "♫" : "♪";
  button.setAttribute("aria-pressed", String(playing));
}

$("musicToggle")?.addEventListener("click", async () => {
  const music = $("backgroundMusic");
  if (!music) return;

  try {
    if (music.paused) {
      await music.play();
    } else {
      music.pause();
    }

    updateMusicButton();
  } catch {
    showStatus(
      $("copyStatus"),
      "Musik belum dapat diputar. Pastikan file musik tersedia.",
      true
    );
  }
});

$("backgroundMusic")?.addEventListener("play", updateMusicButton);
$("backgroundMusic")?.addEventListener("pause", updateMusicButton);
