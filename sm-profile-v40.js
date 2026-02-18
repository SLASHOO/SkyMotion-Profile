    (() => {
      const ROOT = document.getElementById("sm-profile-v40");
      if (!ROOT) return;
      if (ROOT.dataset.smInit === "1") return;
      ROOT.dataset.smInit = "1";

      const DEFAULT_AVATAR =
        "https://cdn.prod.website-files.com/6766d6c8fc7f71813b295766/694985213eb9a28b77237169_favicon-logo-big.ico";

      const API_BASE = String(window.SM_API_BASE || "https://skymotion.onrender.com").replace(/\/$/, "");
      const ROUTES = { session: "/session", library: "/libraryy" };

      const ENDPOINTS = {
        profileGet: () => `${API_BASE}/v1/profile`,
        profilePut: () => `${API_BASE}/v1/profile`,
        savedMoves: () => `${API_BASE}/v1/saved-moves?limit=30&offset=0`,
        sessions: () => `${API_BASE}/v1/sessions?status=done&limit=50&offset=0`,
        sessionOne: (id) => `${API_BASE}/v1/sessions/${encodeURIComponent(id)}`,
        uploadAvatar: () => `${API_BASE}/v1/uploads/avatar`,
      };

      const $ = (sel) => ROOT.querySelector(sel);
      const els = {
        username: $("#sm-username"),
        avatar: $("#sm-avatar"),
        editBtn: $("#smEditProfile"),
        avatarBtn: $("#smAvatarBtn"),
        startSession: $("#sm-startSession"),
        how: $("#sm-howItWorks"),
        savedArea: $("#sm-savedArea"),
        savedCount: $("#sm-count"),
        sessionsArea: $("#sm-sessionsArea"),
        sessionsCount: $("#sm-sessionCount"),
        modal: $("#smModal"),
        modalBackdrop: $("#smModalBackdrop"),
        modalContent: $("#smModalContent"),
        weather: $("#smWeatherWidget"),
      };

      function safeText(el, t) { if (el) el.textContent = t == null ? "" : String(t); }
      function escapeHtml(str) {
        return String(str ?? "")
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
      }

      function isAbsoluteHttpUrl(v) { return /^https?:\/\//i.test(String(v || "").trim()); }

      function normalizeAnyUrl(raw) {
        const v = String(raw || "").trim();
        if (!v) return "";
        if (/^https?:\/\//i.test(v)) return v;
        if (v.startsWith("//")) return "https:" + v;
        if (/^[a-z0-9.-]+\.[a-z]{2,}\/.+/i.test(v)) return "https://" + v;
        if (v.startsWith("/")) return API_BASE + v;
        return v;
      }

      function normalizeAvatarUrl(raw) {
        let v = String(raw || "").trim();
        if (!v) return DEFAULT_AVATAR;
        if (isAbsoluteHttpUrl(v)) return v;
        if (v.startsWith("//")) return "https:" + v;
        if (/^[a-z0-9.-]+\.[a-z]{2,}\/.+/i.test(v)) return "https://" + v;
        if (v.startsWith("/")) return API_BASE + v;
        return DEFAULT_AVATAR;
      }

      function setAvatar(url) {
        const img = els.avatar;
        if (!img) return;
        const finalUrl = normalizeAvatarUrl(url);
        img.onerror = null;
        img.src = finalUrl;
        img.onerror = () => { if (img.src !== DEFAULT_AVATAR) img.src = DEFAULT_AVATAR; };
      }

      function openModal(html) {
        if (!els.modal || !els.modalContent) return null;

        els.modalContent.innerHTML = html;

        const close = () => {
          els.modal.setAttribute("aria-hidden", "true");
          document.removeEventListener("keydown", onKey);
        };
        const onKey = (e) => { if (e.key === "Escape") close(); };

        els.modal.setAttribute("aria-hidden", "false");
        document.addEventListener("keydown", onKey);

        if (els.modalBackdrop) els.modalBackdrop.addEventListener("click", close, { once: true });

        return { close, contentEl: els.modalContent };
      }

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // ---------------- Memberstack ----------------
      let memberCache = null;
      let memberCacheAt = 0;

      async function getMember(timeout = 12000) {
        const now = Date.now();
        if (memberCache && now - memberCacheAt < 15000) return memberCache;

        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
          const ms = window.$memberstackDom || window.$memberstack;
          const fn = ms?.getCurrentMember || ms?.getCurrentUser;
          if (typeof fn === "function") {
            try {
              const res = await fn.call(ms);
              const m = res?.data || res;
              if (m?.id) {
                memberCache = m;
                memberCacheAt = Date.now();
                return m;
              }
            } catch (e) {}
          }
          await sleep(250);
        }
        return null;
      }

      function pickNameFromMember(member) {
        const cf = member?.customFields || {};
        return (
          cf.nickname || cf.Nickname || cf.username || cf.Username ||
          member?.name || member?.profile?.name || member?.email || null
        );
      }

      function pickAvatarFromMember(member) {
        const cf = member?.customFields || {};
        const fromCF =
          cf.avatar || cf.Avatar || cf.photo || cf.Photo || cf.image || cf.Image ||
          cf.profile_image || cf.profileImage || cf.avatar_url || cf.avatarUrl;

        const fromProfile =
          member?.profile?.photo || member?.profile?.image || member?.profile?.avatar ||
          member?.profile?.avatarUrl || member?.profile?.avatar_url ||
          member?.profile?.profileImage || member?.profile?.profile_image;

        const fromTop =
          member?.profileImage || member?.profile_image || member?.avatar ||
          member?.avatarUrl || member?.avatar_url || member?.photo || member?.image;

        return fromCF || fromProfile || fromTop || null;
      }

      // ---------------- API helper ----------------
      async function api(url, opts = {}) {
        const member = await getMember(12000);
        if (!member?.id) {
          const err = new Error("LOGIN_REQUIRED");
          err.status = 401;
          throw err;
        }

        const headers = new Headers(opts.headers || {});
        headers.set("x-ms-id", member.id);

        const hasBody = !!opts.body;
        if (hasBody && !(opts.body instanceof FormData) && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }

        const r = await fetch(url, { ...opts, headers, method: opts.method || "GET" });

        const ct = (r.headers.get("content-type") || "").toLowerCase();
        const isJson = ct.includes("application/json");
        const payload = isJson ? await r.json().catch(() => null) : await r.text().catch(() => null);

        if (!r.ok) {
          const e = new Error("HTTP_" + r.status);
          e.status = r.status;
          e.payload = payload;
          throw e;
        }
        return payload;
      }

      // ---------------- Profile ----------------
      let profileState = { nickname: "pilot", avatar_url: DEFAULT_AVATAR };

      function isBackendDefaultNickname(nick) {
        const v = String(nick || "").trim().toLowerCase();
        return !v || v === "pilot";
      }

      function applyProfileToUI(p) {
        const nick = (p?.nickname || "pilot").trim() || "pilot";
        safeText(els.username, nick);
        setAvatar(p?.avatar_url || p?.avatarUrl || DEFAULT_AVATAR);
      }

      async function ensureProfile() {
        const member = await getMember(12000);
        if (!member?.id) throw Object.assign(new Error("LOGIN_REQUIRED"), { status: 401 });

        const msNick = (pickNameFromMember(member) || "pilot").trim() || "pilot";
        const msAva = normalizeAvatarUrl(pickAvatarFromMember(member) || DEFAULT_AVATAR);

        const p = await api(ENDPOINTS.profileGet(), { method: "GET" });

        const backendNickRaw = (p?.nickname || "").trim();
        const backendAvaRaw = (p?.avatar_url || p?.avatarUrl || "").trim();
        const backendAva = normalizeAvatarUrl(backendAvaRaw);

        const backendNickIsDefault = isBackendDefaultNickname(backendNickRaw);
        const backendAvaIsMissing = !backendAvaRaw || backendAva === DEFAULT_AVATAR;

        let uiNick = msNick;
        let uiAva = msAva;

        if (!backendNickIsDefault) uiNick = backendNickRaw;
        if (!backendAvaIsMissing) uiAva = backendAva;

        const normalized = { nickname: uiNick || "pilot", avatar_url: uiAva || DEFAULT_AVATAR };
        profileState = normalized;
        applyProfileToUI(normalized);
        return normalized;
      }

      async function saveProfile({ nickname, avatar_url }) {
        const cleanNick = (nickname || "pilot").trim() || "pilot";
        const cleanAva = normalizeAvatarUrl(avatar_url);

        const body = JSON.stringify({ nickname: cleanNick, avatar_url: cleanAva });
        const saved = await api(ENDPOINTS.profilePut(), { method: "PATCH", body });

        const normalized = {
          nickname: (saved?.nickname || cleanNick).trim() || "pilot",
          avatar_url: normalizeAvatarUrl(saved?.avatar_url || saved?.avatarUrl || cleanAva),
        };
        profileState = normalized;
        applyProfileToUI(normalized);
        return normalized;
      }

      // ---------------- Icons ----------------
      function iconTrash(){
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v9h-2v-9zm4 0h2v9h-2v-9zM7 10h2v9H7v-9z"/></svg>`;
      }
      function iconOpen(){
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7h10v10h-2V10.41l-9.29 9.3-1.42-1.42 9.3-9.29H10V7z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>`;
      }

      // ---------------- Weather widget (animated, iOS-like) ----------------
      function smNum(v){
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }

      function pickDeep(obj, keys){
        for (const k of keys){
          if (!obj) break;
          const parts = k.split(".");
          let cur = obj;
          let ok = true;
          for (const p of parts){
            if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
            else { ok = false; break; }
          }
          if (ok && cur != null && cur !== "") return cur;
        }
        return null;
      }

      function normalizeWeatherType(weather_json){
        const w = weather_json || {};
        const code = pickDeep(w, ["weathercode","code","current.weathercode","current.code"]);
        const main = String(pickDeep(w, ["main","condition","current.condition","current.weather","weather.main"]) || "").toLowerCase();
        const desc = String(pickDeep(w, ["description","desc","current.description","weather.description","weather[0].description"]) || "").toLowerCase();
        const icon = String(pickDeep(w, ["icon","current.icon","weather[0].icon"]) || "").toLowerCase();

        const c = smNum(code);
        if (c != null){
          if (c === 0) return "sun";
          if (c === 1 || c === 2 || c === 3) return "cloud";
          if ([45,48].includes(c)) return "fog";
          if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(c)) return "rain";
          if ([71,73,75,77,85,86].includes(c)) return "snow";
          if ([95,96,99].includes(c)) return "storm";
        }

        const s = (main + " " + desc + " " + icon).trim();
        if (s.includes("thunder") || s.includes("storm")) return "storm";
        if (s.includes("snow") || s.includes("sleet")) return "snow";
        if (s.includes("rain") || s.includes("drizzle") || s.includes("shower")) return "rain";
        if (s.includes("wind")) return "wind";
        if (s.includes("fog") || s.includes("mist") || s.includes("haze")) return "fog";
        if (s.includes("cloud") || s.includes("overcast")) return "cloud";
        if (s.includes("clear") || s.includes("sun")) return "sun";
        return "cloud";
      }

      function svgForWeather(type){
        if (type === "sun") return `
          <svg class="smWxSun" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <g class="sunRays">
              <circle cx="27" cy="27" r="10" fill="rgba(255,180,60,.95)"></circle>
              <g fill="rgba(255,180,60,.75)">
                <rect x="26" y="4" width="2" height="8" rx="1"></rect>
                <rect x="26" y="42" width="2" height="8" rx="1"></rect>
                <rect x="4" y="26" width="8" height="2" rx="1"></rect>
                <rect x="42" y="26" width="8" height="2" rx="1"></rect>
                <rect x="10" y="10" width="2" height="8" rx="1" transform="rotate(-45 11 14)"></rect>
                <rect x="42" y="10" width="2" height="8" rx="1" transform="rotate(45 43 14)"></rect>
                <rect x="10" y="36" width="2" height="8" rx="1" transform="rotate(45 11 40)"></rect>
                <rect x="42" y="36" width="2" height="8" rx="1" transform="rotate(-45 43 40)"></rect>
              </g>
            </g>
          </svg>
        `;

        if (type === "rain") return `
          <svg class="smWxRain" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <g class="cloud">
              <path d="M18 32c-4.4 0-8-3.2-8-7.2 0-3.5 2.8-6.5 6.6-7.1C18 13.6 21 11 25 11c5.1 0 9.3 4 9.6 9.1 4 .6 7 3.5 7 7.3 0 4-3.6 7.2-8 7.2H18z"
                fill="rgba(255,255,255,.78)"/>
            </g>
            <g fill="rgba(140,200,255,.95)">
              <rect class="drop d1" x="18" y="34" width="2" height="8" rx="1"></rect>
              <rect class="drop d2" x="26" y="34" width="2" height="8" rx="1"></rect>
              <rect class="drop d3" x="34" y="34" width="2" height="8" rx="1"></rect>
            </g>
          </svg>
        `;

        if (type === "snow") return `
          <svg class="smWxSnow" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <g class="cloud">
              <path d="M18 32c-4.4 0-8-3.2-8-7.2 0-3.5 2.8-6.5 6.6-7.1C18 13.6 21 11 25 11c5.1 0 9.3 4 9.6 9.1 4 .6 7 3.5 7 7.3 0 4-3.6 7.2-8 7.2H18z"
                fill="rgba(255,255,255,.78)"/>
            </g>
            <g fill="rgba(210,240,255,.95)">
              <circle class="flake f1" cx="20" cy="38" r="1.8"></circle>
              <circle class="flake f2" cx="28" cy="38" r="1.8"></circle>
              <circle class="flake f3" cx="36" cy="38" r="1.8"></circle>
            </g>
          </svg>
        `;

        if (type === "wind") return `
          <svg class="smWxWind" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <g fill="none" stroke="rgba(255,255,255,.80)" stroke-width="3" stroke-linecap="round">
              <path d="M14 22c6 0 10-3 16-3 4 0 6 2 6 4 0 2-2 4-5 4"></path>
            </g>
            <g fill="none" stroke="rgba(255,255,255,.70)" stroke-width="3" stroke-linecap="round">
              <path d="M10 30c8 0 12-3 20-3 4 0 6 2 6 4 0 2-2 4-5 4"></path>
            </g>
            <g class="gust" fill="none" stroke="rgba(160,220,255,.55)" stroke-width="2" stroke-linecap="round">
              <path d="M8 20h10"></path>
            </g>
            <g class="gust g2" fill="none" stroke="rgba(160,220,255,.45)" stroke-width="2" stroke-linecap="round">
              <path d="M8 28h14"></path>
            </g>
            <g class="gust g3" fill="none" stroke="rgba(160,220,255,.35)" stroke-width="2" stroke-linecap="round">
              <path d="M8 36h12"></path>
            </g>
          </svg>
        `;

        if (type === "storm") return `
          <svg class="smWxStorm" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <g class="cloud">
              <path d="M18 32c-4.4 0-8-3.2-8-7.2 0-3.5 2.8-6.5 6.6-7.1C18 13.6 21 11 25 11c5.1 0 9.3 4 9.6 9.1 4 .6 7 3.5 7 7.3 0 4-3.6 7.2-8 7.2H18z"
                fill="rgba(255,255,255,.78)"/>
            </g>
            <path class="bolt" d="M26 34l-4 8h4l-3 9 9-13h-4l3-4z" fill="rgba(255,210,90,.95)"/>
            <g fill="rgba(140,200,255,.95)">
              <rect class="drop d1" x="16" y="34" width="2" height="8" rx="1"></rect>
              <rect class="drop d2" x="34" y="34" width="2" height="8" rx="1"></rect>
            </g>
          </svg>
        `;

        if (type === "fog") return `
          <svg class="smWxCloud" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <g class="cloud">
              <path d="M18 30c-4.4 0-8-3.1-8-7 0-3.4 2.8-6.3 6.6-6.9C18 12.3 21 10 25 10c5.1 0 9.3 3.9 9.6 8.9 4 .6 7 3.4 7 7.1 0 3.9-3.6 7-8 7H18z"
                fill="rgba(255,255,255,.78)"/>
            </g>
            <g fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2" stroke-linecap="round">
              <path d="M14 36h26"></path>
              <path d="M16 40h22"></path>
            </g>
          </svg>
        `;

        return `
          <svg class="smWxCloud" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <g class="cloud">
              <path d="M18 32c-4.4 0-8-3.2-8-7.2 0-3.5 2.8-6.5 6.6-7.1C18 13.6 21 11 25 11c5.1 0 9.3 4 9.6 9.1 4 .6 7 3.5 7 7.3 0 4-3.6 7.2-8 7.2H18z"
                fill="rgba(255,255,255,.78)"/>
            </g>
          </svg>
        `;
      }

            function weatherPillHtml(weather_json, city){
          if (!weather_json) return "";
        
          const w = weather_json || {};
          const temp =
            smNum(pickDeep(w, ["temp","temperature","current.temperature","current.temp","main.temp"])) ??
            smNum(pickDeep(w, ["air_temperature","t"])) ??
            null;
        
          const desc = (pickDeep(w, ["description","desc","current.description","weather[0].description","summary","condition"]) || "").toString();
          const type = normalizeWeatherType(w);
        
          const tTxt = (temp == null) ? "—" : `${Math.round(temp)}°`;
          const fallbackDesc = (type === "sun" ? "Clear" :
                                type === "rain" ? "Rain" :
                                type === "snow" ? "Snow" :
                                type === "wind" ? "Windy" :
                                type === "storm" ? "Storm" :
                                type === "fog" ? "Fog" : "Cloudy");
        
          const label = `${tTxt} · ${(desc || fallbackDesc)}`;
        
          // class для ambience (is-sun/is-rain/...)
          const cls =
            type === "sun" ? "is-sun" :
            type === "rain" ? "is-rain" :
            type === "snow" ? "is-snow" :
            type === "wind" ? "is-wind" :
            type === "storm" ? "is-storm" :
            type === "fog" ? "is-fog" : "is-clouds";
        
          // беремо твій svgForWeather(), просто зменшимо через CSS
          const icon = svgForWeather(type);
        
          return `
            <div class="sessTopRow">
              <div class="sessWeather ${cls}" title="${escapeHtml(city || "")}">
                <span class="wIconWrap" aria-hidden="true">${icon}</span>
                <span class="wText">${escapeHtml(label)}</span>
              </div>
            </div>
          `;
        }
        
        async function hydrateSessionWeatherIntoCard(cardEl, sessionId){
          if (!cardEl || !sessionId) return;
          if (cardEl.dataset.wxHydrated === "1") return;
          cardEl.dataset.wxHydrated = "1";
        
          try{
            const detail = await api(ENDPOINTS.sessionOne(sessionId), { method:"GET" });
            const s = detail?.session || detail || null;
            const weather = s?.weather_json || s?.weather || null;
            const city = s?.location_name || "";
        
            if (!weather) return;
        
            const top = cardEl.querySelector(".sessTopRowHost");
            if (!top) return;
        
            top.innerHTML = weatherPillHtml(weather, city);
          }catch(e){
           
          }
        }
        

      function renderWeatherWidget(weather_json, opts = {}){
        const el = els.weather;
        if (!el) return;

        const w = weather_json || {};
        const city = (opts.city || pickDeep(w, ["city","location_name","location.name","place"]) || "").toString();

        const temp =
          smNum(pickDeep(w, ["temp","temperature","current.temperature","current.temp","main.temp"])) ??
          smNum(pickDeep(w, ["air_temperature","t"])) ??
          null;

        const wind =
          smNum(pickDeep(w, ["wind_kph","wind_kmh","wind.speed","current.windspeed","wind_speed","wind"])) ??
          null;

        const desc =
          (pickDeep(w, ["description","desc","current.description","weather[0].description","summary","condition"]) || "").toString();

        const type = normalizeWeatherType(w);
        const iconSvg = svgForWeather(type);

        const tempTxt = (temp == null) ? "—" : `${Math.round(temp)}°`;
        const windTxt = (wind == null) ? "" : `Wind ${Math.round(wind)} km/h`;
        const fallbackDesc = (type === "sun" ? "Clear" :
                              type === "rain" ? "Rain" :
                              type === "snow" ? "Snow" :
                              type === "wind" ? "Windy" :
                              type === "storm" ? "Storm" :
                              type === "fog" ? "Fog" : "Cloudy");

        el.style.display = "flex";
        el.innerHTML = `
          <div class="wIcon">${iconSvg}</div>
          <div class="wText">
            <div class="wTop">
              <div class="wTemp">${escapeHtml(tempTxt)}</div>
              <div class="wCity">${escapeHtml(city || "Last session")}</div>
            </div>
            <div class="wDesc">${escapeHtml(desc || fallbackDesc)}</div>
            <div class="wMeta">
              ${windTxt ? `<span>${escapeHtml(windTxt)}</span>` : ``}
            </div>
          </div>
        `;
      }

      function hideWeatherWidget(){
        if (!els.weather) return;
        els.weather.style.display = "none";
        els.weather.innerHTML = "";
      }

      // ---------------- Saved moves (UI + Delete) ----------------
      function getMoveId(m){
        return m?.id || m?.move_id || m?.saved_id || m?.slug || m?.videoUrl || m?.video_url || null;
      }
      function getMoveTitle(m, i) { return m?.title || m?.name || m?.move_title || `Move ${i + 1}`; }
      function getMoveThumb(m) { return m?.thumb || m?.thumbUrl || m?.thumbnail || m?.image || m?.cover_url || ""; }
      function getMoveVideo(m) { return m?.videoUrl || m?.video_url || m?.url || m?.playbackUrl || ""; }

      async function deleteSavedMove(id){
        const url = `${API_BASE}/v1/saved-moves/${encodeURIComponent(id)}`;
        return api(url, { method: "DELETE" });
      }

      function renderSavedMoves(list, { requiresLogin = false, hardError = "" } = {}) {
        const area = els.savedArea;
        if (!area) return;

        const items = Array.isArray(list) ? list : [];
        safeText(els.savedCount, requiresLogin ? "Login required" : `${items.length} saved`);
        area.innerHTML = "";

        if (requiresLogin) {
          area.innerHTML = `
            <div class="sheetCard" style="color:rgba(255,255,255,.78);">
              <div style="font-weight:850; margin-bottom:6px;">Login required</div>
              Log in to see your saved moves.
            </div>`;
          return;
        }

        if (hardError) {
          area.innerHTML = `
            <div class="sheetCard" style="color:rgba(255,255,255,.78);">
              <div style="font-weight:850; margin-bottom:6px;">Saved moves unavailable</div>
              ${escapeHtml(hardError)}
            </div>`;
          return;
        }

        if (!items.length) {
          area.innerHTML = `
            <div class="sheetCard" style="color:rgba(255,255,255,.78); line-height:1.45;">
              <div style="font-weight:850; margin-bottom:6px;">No saved moves yet</div>
              <div style="margin-top:12px;">
                <button class="smBtn smBtnPrimary" type="button" id="smGoLibrary">Open Library</button>
              </div>
            </div>`;
          ROOT.querySelector("#smGoLibrary")?.addEventListener("click", () => (location.href = ROUTES.library));
          return;
        }

        let live = items.slice(0, 30);

        const paint = () => {
          area.innerHTML = "";
          safeText(els.savedCount, `${live.length} saved`);

          live.forEach((m, i) => {
            const id = getMoveId(m);
            const title = getMoveTitle(m, i);
            const thumb = normalizeAnyUrl(getMoveThumb(m));
            const video = normalizeAnyUrl(getMoveVideo(m));
            const meta = (m?.mood || m?.category || m?.level || m?.tag || "").toString();

            const card = document.createElement("div");
            card.className = "moveCard";
            card.dataset.id = id || "";

            const thumbHtml = thumb
              ? `<div class="moveThumb"><img src="${escapeHtml(thumb)}" alt="" loading="lazy">${video ? `<span class="playDot"></span>` : ""}</div>`
              : `<div class="moveThumb">${video ? `<span class="playDot"></span>` : ""}</div>`;

            card.innerHTML = `
              ${thumbHtml}
              <div class="moveMain">
                <div class="moveTitle">${escapeHtml(title)}</div>
                <div class="moveMeta2">${escapeHtml(meta)}</div>
              </div>
              <div class="moveActions">
                <button class="smIconBtn" type="button" data-act="open" aria-label="Open">${iconOpen()}</button>
                <button class="smIconBtn smDanger" type="button" data-act="delete" aria-label="Delete">${iconTrash()}</button>
              </div>
            `;

            card.querySelector('[data-act="open"]')?.addEventListener("click", () => {
              const mediaHtml = video
                ? `<video controls playsinline style="width:100%; border-radius:14px; background:#000;">
                     <source src="${escapeHtml(video)}" type="video/mp4" />
                   </video>`
                : thumb
                ? `<img src="${escapeHtml(thumb)}" alt="" style="width:100%; border-radius:14px; display:block;" />`
                : "";

              const ctl = openModal(`
                <div class="sessionSheet">
                  <div class="sheetTop">
                    <div class="sheetTitle">${escapeHtml(title)}</div>
                    <button class="sheetClose" type="button" data-sm-close aria-label="Close">✕</button>
                  </div>
                  <div class="sheetBody">
                    ${mediaHtml ? `<div class="sheetCard">${mediaHtml}</div>` : ``}
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                      <button class="smBtn" type="button" id="smGoLibraryFromMove">Open Library</button>
                    </div>
                  </div>
                </div>`);
              if (!ctl) return;
              ctl.contentEl.querySelector("[data-sm-close]")?.addEventListener("click", ctl.close);
              ctl.contentEl.querySelector("#smGoLibraryFromMove")?.addEventListener("click", () => (location.href = ROUTES.library));
            });

            card.querySelector('[data-act="delete"]')?.addEventListener("click", async () => {
              if (!id) return alert("Missing move id (backend can’t delete).");
              if (!confirm("Remove this move from Saved?")) return;

              card.classList.add("isDeleting");
              const prev = live.slice();
              live = live.filter(x => getMoveId(x) !== id);
              paint();

              try{
                await deleteSavedMove(id);
              }catch(e){
                live = prev;
                paint();
                alert(e?.status === 405 ? "Delete blocked (405). Fix CORS/OPTIONS on backend." : "Failed to delete. Check backend logs.");
              }
            });

            area.appendChild(card);
          });
        };

        paint();
      }

      async function loadSavedMoves() {
        try {
          safeText(els.savedCount, "Loading…");
          const data = await api(ENDPOINTS.savedMoves(), { method: "GET" });
          const rows = Array.isArray(data) ? data : (data?.items || data?.saved_moves || data?.moves || []);
          renderSavedMoves(rows);
        } catch (e) {
          if (e?.status === 401) return renderSavedMoves([], { requiresLogin: true });
          if (e?.status === 405) return renderSavedMoves([], { hardError: "Backend returned 405. Fix CORS/OPTIONS for header x-ms-id." });
          return renderSavedMoves([], { hardError: "Failed to load from backend." });
        }
      }

      // ---------------- Sessions (overlay + Delete + Weather source) ----------------
      function parseISO(d) {
        if (!d) return null;
        const x = new Date(d);
        return isNaN(x.getTime()) ? null : x;
      }

      function formatDateTime(iso) {
        const d = parseISO(iso);
        if (!d) return { date: "Session", time: "" };
        return {
          date: d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" }),
          time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        };
      }

      function getSessionId(s) {
        return s?.id || s?.session_id || null;
      }

      function getSessionCity(s) {
        const name = String(s?.location_name || "").trim();
        if (!name) return "Unknown";
        if (/^point/i.test(name)) return "Unknown";
        return name;
      }

         function getSessionMovesCount(s) {
      // пріоритет 1: бек уже порахував
      if (typeof s?.moves_count === "number") return s.moves_count;
    
      const lib = s?.library_results_json || null;
    
      // пріоритет 2: ми самі записали filtered_count в Library
      const fc = Number(lib?.filtered_count);
      if (Number.isFinite(fc) && fc > 0) return fc;
    
      // пріоритет 3: якщо користувач відкривав відео — рахуємо opened_videos
      if (Array.isArray(lib?.opened_videos)) return lib.opened_videos.length;
    
      // фолбек 0
      return 0;
    }

      function getSessionCover(s) {
        const raw = s?.cover_image_url || s?.assistant_photo_url || "";
        if (!raw) return "";
        return normalizeAnyUrl(raw);
      }

      async function deleteSessionById(id){
        try{
          return await api(`${API_BASE}/v1/sessions/${encodeURIComponent(id)}`, { method:"DELETE" });
        }catch(e){
          try{
            return await api(`${API_BASE}/v1/sessions/${encodeURIComponent(id)}`, {
              method:"PATCH",
              body: JSON.stringify({ status: "deleted" })
            });
          }catch(e2){
            throw e;
          }
        }
      }

      function openSessionFallbackModal(s){
        const id = getSessionId(s);
        const city = getSessionCity(s);
        const dt = formatDateTime(s?.ended_at || s?.started_at);
        const cover = getSessionCover(s);

        const coverHtml = cover
          ? `<div class="sheetCard"><img src="${escapeHtml(cover)}" alt="" style="width:100%; border-radius:14px; display:block;" /></div>`
          : "";

        const ctl = openModal(`
          <div class="sessionSheet">
            <div class="sheetTop">
              <div class="sheetTitle">${escapeHtml(dt.date)} — ${escapeHtml(city)}</div>
              <button class="sheetClose" type="button" data-sm-close aria-label="Close">✕</button>
            </div>
            <div class="sheetBody">
              ${coverHtml}
              <div class="sheetCard">
                <div style="font-weight:850; margin-bottom:6px;">Session</div>
                <pre style="margin:0; white-space:pre-wrap; color:rgba(255,255,255,.82); font-size:12px; line-height:1.55;">${escapeHtml(JSON.stringify(s, null, 2))}</pre>
              </div>
              ${id ? `<div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button class="smBtn smBtnPrimary" type="button" id="smDeleteSessionFromModal">Delete session</button>
              </div>` : ``}
            </div>
          </div>`);
        if (!ctl) return;

        ctl.contentEl.querySelector("[data-sm-close]")?.addEventListener("click", ctl.close);

        const delBtn = ctl.contentEl.querySelector("#smDeleteSessionFromModal");
        delBtn?.addEventListener("click", async () => {
          if (!id) return;
          if (!confirm("Delete this session from history?")) return;
          delBtn.disabled = true;
          delBtn.textContent = "Deleting…";
          try{
            await deleteSessionById(id);
            ctl.close();
            await loadSessions();
          }catch(e){
            delBtn.disabled = false;
            delBtn.textContent = "Delete session";
            alert(e?.status === 405 ? "Delete blocked (405). Fix CORS/OPTIONS on backend." : "Failed to delete session.");
          }
        });
      }

              function renderSessions(list) {
          const area = els.sessionsArea;
          if (!area) return;
        
          area.innerHTML = "";
          const rows = Array.isArray(list) ? list : [];
          safeText(els.sessionsCount, `${rows.length} sessions`);
        
          if (!rows.length) {
            area.innerHTML = `<div class="sheetCard" style="color:rgba(255,255,255,.78);">No completed sessions yet</div>`;
            return;
          }
        
          let live = rows.slice();
        
          const paint = () => {
            area.innerHTML = "";
            safeText(els.sessionsCount, `${live.length} sessions`);
        
            live.forEach((s) => {
              const id = getSessionId(s);
              const city = getSessionCity(s);
              const moves = getSessionMovesCount(s);
              const cover = getSessionCover(s);
              const dt = formatDateTime(s?.ended_at || s?.started_at);
        
              const weather = s?.weather_json || s?.weather || null;
        
              const card = document.createElement("div");
              card.className = "sessCard";
              card.tabIndex = 0;
        
              if (cover) {
                  const safe = String(cover).replaceAll('"', "%22");
                  card.style.setProperty("--cover", `url("${safe}")`);
                } else {
                  card.style.setProperty("--cover", "none");
                }

        
              card.innerHTML = `
                <button class="sessDelBtn" type="button" aria-label="Delete session">${iconTrash()}</button>
        
                <div class="sessInner">
                  <div class="sessTopRowHost">
                    ${weather ? weatherPillHtml(weather, city) : ``}
                  </div>
        
                  <div class="sessDate">${escapeHtml(dt.date)}</div>
                  <div class="sessCity">${escapeHtml(city)}</div>
        
                  <div class="sessBottom">
                    <div>${escapeHtml(dt.time)}</div>
                    <div class="sessPill">
                      <span class="pDot"></span>
                      ${moves} moves
                    </div>
                  </div>
                </div>
              `;
        
              // якщо weather нема в списку — ледачо підтягуємо деталі (і підставляємо pill)
              if (!weather && id) {
                hydrateSessionWeatherIntoCard(card, id);
              }
        
              card.addEventListener("click", () => {
                if (typeof window.openSessionModal === "function") window.openSessionModal(s, id);
                else openSessionFallbackModal(s);
              });
        
              card.querySelector(".sessDelBtn")?.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!id) return alert("Missing session id (backend can’t delete).");
                if (!confirm("Delete this session from history?")) return;
        
                card.classList.add("isDeleting");
        
                const prev = live.slice();
                live = live.filter(x => getSessionId(x) !== id);
                paint();
        
                try{
                  await deleteSessionById(id);
                }catch(err){
                  live = prev;
                  paint();
                  alert(err?.status === 405 ? "Delete blocked (405). Fix CORS/OPTIONS on backend." : "Failed to delete session.");
                }
              });
        
              area.appendChild(card);
            });
          };
        
          paint();
        }

      async function loadSessions() {
        try {
          safeText(els.sessionsCount, "Loading…");
          const data = await api(ENDPOINTS.sessions(), { method: "GET" });

          const rows = Array.isArray(data)
            ? data
            : Array.isArray(data?.sessions)
              ? data.sessions
              : [];

          const onlyDone = rows.filter(s => s?.status === "done");

          // sort newest first (ended_at, fallback started_at)
          onlyDone.sort((a,b) => {
            const da = parseISO(a?.ended_at || a?.started_at)?.getTime() || 0;
            const db = parseISO(b?.ended_at || b?.started_at)?.getTime() || 0;
            return db - da;
          });

                      renderSessions(onlyDone);
            const latest = onlyDone[0] || null;
            if (!latest) { hideWeatherWidget(); return; }
            
            let weather = latest?.weather_json || latest?.weather || null;
            let city = latest?.location_name || "";
            
            // If weather not in list response -> fetch details
            if (!weather) {
              const sid = getSessionId(latest);
              if (sid) {
                try {
                  const detail = await api(ENDPOINTS.sessionOne(sid), { method:"GET" });
                  const s = detail?.session || detail || null;
                  weather = s?.weather_json || s?.weather || null;
                  city = s?.location_name || city;
                } catch(e) {}
              }
            }
            
            // ТУТ головне: не ховай віджет завжди
            if (weather) renderWeatherWidget(weather, { city });
            else hideWeatherWidget();
            

        } catch (e) {
          if (e?.status === 401) {
            safeText(els.sessionsCount, "Login required");
            els.sessionsArea.innerHTML = `<div class="sheetCard">Login required</div>`;
            hideWeatherWidget();
            return;
          }
          els.sessionsArea.innerHTML = `<div class="sheetCard">Failed to load sessions</div>`;
          hideWeatherWidget();
        }
      }

      // ---------------- Edit modal ----------------
      function openEditModal() {
        const initName = profileState.nickname || "pilot";
        const initAvatar = profileState.avatar_url || DEFAULT_AVATAR;

        const ctl = openModal(`
          <div class="sessionSheet">
            <div class="sheetTop">
              <div class="sheetTitle">Edit profile</div>
              <button class="sheetClose" type="button" data-sm-close aria-label="Close">✕</button>
            </div>
            <div class="sheetBody">
              <div class="sheetCard">
                <div style="display:flex; gap:14px; align-items:center;">
                  <div style="width:56px; height:56px; border-radius:999px; overflow:hidden; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); flex:0 0 auto;">
                    <img id="smEditAvaPreview" src="${escapeHtml(initAvatar)}" alt="Avatar preview" style="width:100%;height:100%;object-fit:cover;display:block;">
                  </div>
                  <div style="flex:1; min-width:0;">
                    <div style="font-weight:850; margin-bottom:6px;">Nickname</div>
                    <input id="smEditNick" value="${escapeHtml(initName)}"
                      style="width:100%; padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); color:rgba(255,255,255,.92); outline:none;">
                    <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                      <button class="smBtn" type="button" id="smPickAvatar">Choose avatar</button>
                      <button class="smBtn smBtnPrimary" type="button" id="smSaveProfile">Save</button>
                    </div>
                    <div id="smEditHint" style="margin-top:10px; font-size:12px; color:rgba(255,255,255,.58); line-height:1.45;">
                      Avatar uploads to API, then profile saves to DB.
                    </div>
                  </div>
                </div>
                <input id="smEditAvaInput" type="file" accept="image/*" style="display:none" />
              </div>
            </div>
          </div>`);
        if (!ctl) return;
        ctl.contentEl.querySelector("[data-sm-close]")?.addEventListener("click", ctl.close);

        const pickBtn = ctl.contentEl.querySelector("#smPickAvatar");
        const fileInp = ctl.contentEl.querySelector("#smEditAvaInput");
        const preview = ctl.contentEl.querySelector("#smEditAvaPreview");
        const hint = ctl.contentEl.querySelector("#smEditHint");
        const nickInp = ctl.contentEl.querySelector("#smEditNick");
        const saveBtn = ctl.contentEl.querySelector("#smSaveProfile");

        let pickedAvatarUrl = initAvatar;

        pickBtn?.addEventListener("click", () => fileInp?.click());

        fileInp?.addEventListener("change", async () => {
          const f = fileInp.files && fileInp.files[0];
          fileInp.value = "";
          if (!f) return;

          if (!/^image\//.test(f.type)) { if (hint) hint.textContent = "Please choose an image file."; return; }
          if (f.size > 8 * 1024 * 1024) { if (hint) hint.textContent = "Image is too large. Use under 8MB."; return; }

          try {
            if (hint) hint.textContent = "Uploading avatar…";
            const fd = new FormData();
            fd.append("file", f);

            const up = await api(ENDPOINTS.uploadAvatar(), { method: "POST", body: fd });
            const rawUrl = up?.avatar_url || up?.url;
            if (!rawUrl) throw new Error("No avatar_url from backend");
            pickedAvatarUrl = normalizeAvatarUrl(String(rawUrl));

            if (preview) {
              preview.onerror = null;
              preview.src = pickedAvatarUrl;
              preview.onerror = () => (preview.src = DEFAULT_AVATAR);
            }

            applyProfileToUI({ nickname: profileState.nickname, avatar_url: pickedAvatarUrl });
            if (hint) hint.textContent = "Uploaded ✅ Click Save to write profile to DB.";
          } catch (e) {
            if (hint) hint.textContent = (e?.status === 405)
              ? "Upload blocked (405). Fix CORS/OPTIONS on backend."
              : "Upload failed. Check backend logs / console.";
          }
        });

        saveBtn?.addEventListener("click", async () => {
          const nickname = (nickInp?.value || "").trim() || "pilot";
          const avatar_url = pickedAvatarUrl || DEFAULT_AVATAR;

          if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
          if (hint) hint.textContent = "Saving…";

          try {
            await saveProfile({ nickname, avatar_url });
            if (hint) hint.textContent = "Saved ✅";
            if (saveBtn) saveBtn.textContent = "Saved";
            setTimeout(() => ctl.close(), 650);
          } catch (e) {
            if (hint) hint.textContent =
              e?.status === 401 ? "Please log in." :
              e?.status === 405 ? "Blocked (405). Fix CORS/OPTIONS on backend." :
              "Save failed.";
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
          }
        });
      }

      // ---------------- Init ----------------
      (async function init() {
        els.startSession?.addEventListener("click", () => (location.href = ROUTES.session));
        els.how?.addEventListener("click", () => alert("How it works — coming soon"));

        safeText(els.username, "pilot");
        setAvatar(DEFAULT_AVATAR);

        const m = await getMember(12000);
        if (m?.id) {
          const msNick = (pickNameFromMember(m) || "pilot").trim() || "pilot";
          const msAva = normalizeAvatarUrl(pickAvatarFromMember(m) || DEFAULT_AVATAR);
          applyProfileToUI({ nickname: msNick, avatar_url: msAva });
        }

        safeText(els.savedCount, "Loading…");
        safeText(els.sessionsCount, "Loading…");
        hideWeatherWidget();

        try { await ensureProfile(); } catch (e) {}

        els.avatarBtn?.addEventListener("click", () => els.editBtn?.click());
        els.editBtn?.addEventListener("click", async () => {
          const m2 = await getMember(12000);
          if (!m2?.id) return alert("Please log in");
          try { await ensureProfile(); } catch (e) {}
          openEditModal();
        });

        await loadSavedMoves();
        await loadSessions();
      })();
    })();
