(function () {
  "use strict";

  var RETURN_KEY = "mcp_oauth_return";
  var root = document.getElementById("consent-root");
  var statusEl = document.getElementById("consent-status");

  var oauth = readOauthParams();
  var ctx = null;
  var scopeType = "sessions";
  var selectedSessions = {};
  var selectedGroup = "";
  var perms = {};
  var lifetime = false;
  var busy = false;

  function readOauthParams() {
    var q = new URLSearchParams(location.search);
    return {
      response_type: q.get("response_type") || "",
      client_id: q.get("client_id") || "",
      redirect_uri: q.get("redirect_uri") || "",
      code_challenge: q.get("code_challenge") || "",
      code_challenge_method: q.get("code_challenge_method") || "",
      state: q.get("state") || ""
    };
  }

  function token() {
    try {
      return localStorage.getItem("agj_token") || "";
    } catch {
      return "";
    }
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = isError ? "consent-error" : "";
  }

  function create(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function storeReturnAndLogin() {
    try {
      if (location.pathname === "/oauth/authorize") {
        sessionStorage.setItem(RETURN_KEY, location.pathname + location.search + location.hash);
      }
    } catch {}
    location.assign("/");
  }

  function appendRedirect(redirectUri, params) {
    var url = new URL(redirectUri);
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function goRedirect(params) {
    var target = (ctx && ctx.redirect_uri) || oauth.redirect_uri;
    if (!target) {
      setStatus("Missing redirect URI.", true);
      return;
    }
    location.replace(appendRedirect(target, params));
  }

  function poolNames() {
    return Array.isArray(ctx && ctx.pool) ? ctx.pool.map(String) : [];
  }

  function groups() {
    return Array.isArray(ctx && ctx.groups) ? ctx.groups : [];
  }

  function selectedSessionList() {
    return poolNames().filter(function (name) {
      return selectedSessions[name];
    });
  }

  function chosenGroup() {
    var id = selectedGroup;
    for (var i = 0; i < groups().length; i++) {
      if (groups()[i].id === id) return groups()[i];
    }
    return null;
  }

  function canApprove() {
    var pool = poolNames();
    if (pool.length === 0) return false;
    if (scopeType === "group") {
      var group = chosenGroup();
      return !!(group && Array.isArray(group.sessions) && group.sessions.length > 0);
    }
    return selectedSessionList().length > 0;
  }

  function enabledPerms() {
    var names = Array.isArray(ctx && ctx.permissions) ? ctx.permissions : [];
    return names.filter(function (name) {
      return perms[name] !== false;
    });
  }

  function oauthBody(extra) {
    var body = {
      response_type: oauth.response_type,
      client_id: oauth.client_id,
      redirect_uri: oauth.redirect_uri,
      code_challenge: oauth.code_challenge,
      code_challenge_method: oauth.code_challenge_method,
      state: oauth.state
    };
    Object.keys(extra || {}).forEach(function (key) {
      body[key] = extra[key];
    });
    return body;
  }

  async function api(path, payload) {
    var headers = { "Content-Type": "application/json" };
    var bearer = token();
    if (bearer) headers.Authorization = "Bearer " + bearer;
    var res = await fetch(path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });
    var data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    return { status: res.status, data: data };
  }

  function render() {
    if (!root || !ctx) return;
    root.textContent = "";
    var heading = create("h1");
    heading.textContent = "Grant MCP access";
    root.appendChild(heading);

    var agent = create("div", "consent-agent");
    var nameEl = create("div", "consent-agent-name");
    nameEl.setAttribute("data-testid", "mcp-consent-client-name");
    nameEl.textContent = ctx.client_name || "Unknown agent";
    var idEl = create("div", "consent-agent-id");
    idEl.setAttribute("data-testid", "mcp-consent-client-id");
    idEl.textContent = ctx.client_id_suffix ? "id …" + ctx.client_id_suffix : "";
    agent.appendChild(nameEl);
    agent.appendChild(idEl);
    root.appendChild(agent);

    var pool = poolNames();
    if (pool.length === 0) {
      var empty = create("p", "consent-hint");
      empty.setAttribute("data-testid", "mcp-consent-empty-pool");
      empty.textContent = "Curate the grantable pool first.";
      root.appendChild(empty);
    }

    var scopeSection = create("section", "consent-section");
    var scopeTitle = create("h2");
    scopeTitle.textContent = "Scope";
    scopeSection.appendChild(scopeTitle);

    var mode = create("div", "consent-mode");
    mode.setAttribute("data-testid", "mcp-scope-picker");
    mode.appendChild(radio("sessions", "Specific sessions", scopeType === "sessions"));
    mode.appendChild(radio("group", "A group", scopeType === "group"));
    scopeSection.appendChild(mode);

    if (scopeType === "sessions") {
      pool.forEach(function (name) {
        scopeSection.appendChild(sessionCheck(name));
      });
    } else {
      var list = groups();
      if (list.length === 0) {
        var noGroups = create("p", "consent-hint");
        noGroups.textContent = "No groups available.";
        scopeSection.appendChild(noGroups);
      }
      list.forEach(function (group) {
        scopeSection.appendChild(groupRadio(group));
      });
    }
    root.appendChild(scopeSection);

    var permSection = create("section", "consent-section");
    var permTitle = create("h2");
    permTitle.textContent = "Permissions";
    permSection.appendChild(permTitle);
    (ctx.permissions || []).forEach(function (name) {
      permSection.appendChild(permCheck(name));
    });
    root.appendChild(permSection);

    var lifeSection = create("section", "consent-section");
    var lifeLabel = create("label", "consent-check");
    var lifeInput = document.createElement("input");
    lifeInput.type = "checkbox";
    lifeInput.checked = lifetime;
    lifeInput.setAttribute("data-testid", "mcp-lifetime-toggle");
    lifeInput.addEventListener("change", function () {
      lifetime = lifeInput.checked;
    });
    var lifeText = document.createElement("span");
    lifeText.textContent = "Lifetime access (off by default)";
    lifeLabel.appendChild(lifeInput);
    lifeLabel.appendChild(lifeText);
    lifeSection.appendChild(lifeLabel);
    root.appendChild(lifeSection);

    var status = create("p", "consent-hint");
    status.id = "consent-status";
    statusEl = status;
    root.appendChild(status);

    var actions = create("div", "consent-actions");
    var denyBtn = create("button", "consent-btn consent-btn-deny");
    denyBtn.type = "button";
    denyBtn.setAttribute("data-testid", "mcp-consent-deny");
    denyBtn.textContent = "Deny";
    denyBtn.addEventListener("click", function () {
      submit("deny");
    });
    var approveBtn = create("button", "consent-btn consent-btn-primary");
    approveBtn.type = "button";
    approveBtn.setAttribute("data-testid", "mcp-consent-approve");
    approveBtn.textContent = "Approve";
    approveBtn.disabled = !canApprove() || busy;
    approveBtn.addEventListener("click", function () {
      submit("approve");
    });
    actions.appendChild(denyBtn);
    actions.appendChild(approveBtn);
    root.appendChild(actions);
  }

  function radio(value, labelText, checked) {
    var label = create("label", "consent-option");
    var input = document.createElement("input");
    input.type = "radio";
    input.name = "mcp-scope-type";
    input.value = value;
    input.checked = checked;
    input.addEventListener("change", function () {
      if (!input.checked) return;
      scopeType = value;
      render();
    });
    var span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  function sessionCheck(name) {
    var label = create("label", "consent-check");
    label.setAttribute("data-testid", "mcp-scope-option");
    label.setAttribute("data-session", name);
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!selectedSessions[name];
    input.addEventListener("change", function () {
      selectedSessions[name] = input.checked;
      render();
    });
    var span = document.createElement("span");
    span.textContent = name;
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  function groupRadio(group) {
    var empty = !group.sessions || group.sessions.length === 0;
    var label = create("label", "consent-check");
    label.setAttribute("data-testid", "mcp-scope-option");
    label.setAttribute("data-group", group.id);
    var input = document.createElement("input");
    input.type = "radio";
    input.name = "mcp-scope-group";
    input.value = group.id;
    input.checked = selectedGroup === group.id;
    input.disabled = empty;
    input.addEventListener("change", function () {
      if (!input.checked) return;
      selectedGroup = group.id;
      render();
    });
    var span = document.createElement("span");
    span.textContent = group.name + (empty ? " (empty)" : "");
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  function permCheck(name) {
    var label = create("label", "consent-check");
    label.setAttribute("data-testid", "mcp-perm-toggle");
    label.setAttribute("data-perm", name);
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = perms[name] !== false;
    input.addEventListener("change", function () {
      perms[name] = input.checked;
    });
    var span = document.createElement("span");
    span.textContent = name;
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  async function submit(decision) {
    if (busy) return;
    if (decision === "approve" && !canApprove()) return;
    busy = true;
    render();
    var extra = { decision: decision };
    if (decision === "approve") {
      extra.lifetime = lifetime === true;
      extra.permissions = enabledPerms();
      if (scopeType === "group") {
        extra.scope_type = "group";
        extra.scope_ref = selectedGroup;
      } else {
        extra.scope_type = "sessions";
        extra.scope_ref = JSON.stringify(selectedSessionList());
      }
    }
    try {
      var res = await api("/api/mcp/consent/decision", oauthBody(extra));
      if (res.status === 401) {
        storeReturnAndLogin();
        return;
      }
      if (res.status === 403) {
        setStatus(res.data.error || "Not allowed to approve.", true);
        busy = false;
        render();
        return;
      }
      if (decision === "deny") {
        goRedirect({
          error: res.data.error || "access_denied",
          state: res.data.state || oauth.state,
          iss: res.data.iss || location.origin
        });
        return;
      }
      if (!res.data.code) {
        setStatus(res.data.error || "Approve failed.", true);
        busy = false;
        render();
        return;
      }
      goRedirect({
        code: res.data.code,
        state: res.data.state || oauth.state,
        iss: res.data.iss || location.origin
      });
    } catch {
      setStatus("Consent request failed.", true);
      busy = false;
      render();
    }
  }

  async function boot() {
    if (!oauth.client_id || !oauth.redirect_uri || !oauth.code_challenge) {
      setStatus("Invalid authorization request.", true);
      return;
    }
    if (!token()) {
      storeReturnAndLogin();
      return;
    }
    try {
      var res = await api("/api/mcp/consent/context", oauthBody());
      if (res.status === 401) {
        storeReturnAndLogin();
        return;
      }
      if (res.status >= 400) {
        setStatus(res.data.error || "Unable to load consent.", true);
        return;
      }
      ctx = res.data;
      (ctx.permissions || []).forEach(function (name) {
        perms[name] = true;
      });
      render();
    } catch {
      setStatus("Unable to load consent.", true);
    }
  }

  boot();
})();
