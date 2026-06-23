document.addEventListener("DOMContentLoaded", () => {
    const statusBadge = document.getElementById("status-badge");
    const lockedView = document.getElementById("locked-view");
    const unlockedView = document.getElementById("unlocked-view");
    const searchInput = document.getElementById("search-input");
    const entriesList = document.getElementById("entries-list");
    let allEntries = [];
    // Check connection status & entries
    function updateUI() {
        chrome.runtime.sendMessage({ type: "get_status" }, (response) => {
            const err = chrome.runtime.lastError;
            if (err || !response || !response.unlocked) {
                showLockedState();
                return;
            }
            showUnlockedState();
            loadEntries();
        });
    }
    function showLockedState() {
        statusBadge.textContent = "Locked";
        statusBadge.className = "status-badge locked";
        lockedView.classList.remove("hidden");
        unlockedView.classList.add("hidden");
    }
    function showUnlockedState() {
        statusBadge.textContent = "Unlocked";
        statusBadge.className = "status-badge unlocked";
        lockedView.classList.add("hidden");
        unlockedView.classList.remove("hidden");
    }
    function loadEntries() {
        chrome.runtime.sendMessage({ type: "list_entries" }, (response) => {
            if (response && response.success) {
                allEntries = response.entries || [];
                renderEntries(allEntries);
            }
            else {
                showLockedState();
            }
        });
    }
    function renderEntries(entries) {
        entriesList.innerHTML = "";
        if (entries.length === 0) {
            const li = document.createElement("li");
            li.className = "no-entries";
            li.textContent = "No entries found";
            entriesList.appendChild(li);
            return;
        }
        entries.forEach((entry) => {
            const li = document.createElement("li");
            li.className = "entry-item";
            li.dataset.id = entry.id;
            const detailsDiv = document.createElement("div");
            detailsDiv.className = "entry-details";
            const titleSpan = document.createElement("span");
            titleSpan.className = "entry-title";
            titleSpan.textContent = entry.title;
            detailsDiv.appendChild(titleSpan);
            if (entry.username) {
                const userSpan = document.createElement("span");
                userSpan.className = "entry-username";
                userSpan.textContent = entry.username;
                detailsDiv.appendChild(userSpan);
            }
            li.appendChild(detailsDiv);
            const actionsDiv = document.createElement("div");
            actionsDiv.className = "entry-actions";
            const fillBtn = document.createElement("button");
            fillBtn.className = "fill-btn";
            fillBtn.textContent = "Autofill";
            fillBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                fillEntry(entry.id, fillBtn);
            });
            actionsDiv.appendChild(fillBtn);
            li.appendChild(actionsDiv);
            // Clicking the entire row fills it as well
            li.addEventListener("click", () => {
                fillEntry(entry.id, fillBtn);
            });
            entriesList.appendChild(li);
        });
    }
    function fillEntry(id, button) {
        const originalText = button.textContent;
        button.textContent = "Filling...";
        button.disabled = true;
        chrome.runtime.sendMessage({ type: "fill_entry", id }, (response) => {
            button.disabled = false;
            if (response && response.success) {
                button.textContent = "Filled!";
                button.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)"; // Green
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = ""; // restore default
                }, 1500);
            }
            else {
                button.textContent = "Error";
                button.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"; // Red
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = "";
                }, 1500);
            }
        });
    }
    // Filter list on search input
    searchInput.addEventListener("input", () => {
        const query = searchInput.value.toLowerCase();
        const filtered = allEntries.filter((entry) => entry.title.toLowerCase().includes(query) ||
            (entry.username && entry.username.toLowerCase().includes(query)));
        renderEntries(filtered);
    });
    // Run initial state update
    updateUI();
});
export {};
