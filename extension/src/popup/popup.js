"use strict";
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
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            let hostname = "";
            if (tabs && tabs[0] && tabs[0].url) {
                try {
                    hostname = new URL(tabs[0].url).hostname;
                }
                catch (e) {
                    // Ignore parse errors (e.g. chrome:// links)
                }
            }
            // Fetch all entries so search works immediately
            chrome.runtime.sendMessage({ type: "list_entries" }, (allResponse) => {
                if (allResponse && allResponse.success) {
                    allEntries = allResponse.entries || [];
                    if (hostname) {
                        // Retrieve matches for this site
                        chrome.runtime.sendMessage({ type: "credential_request", hostname }, (matchResponse) => {
                            if (matchResponse && matchResponse.success && matchResponse.matches && matchResponse.matches.length > 0) {
                                renderEntries(matchResponse.matches);
                            }
                            else {
                                renderEntries([]); // Trigger "No saved credentials for this site"
                            }
                        });
                    }
                    else {
                        renderEntries([]);
                    }
                }
                else {
                    showLockedState();
                }
            });
        });
    }
    function renderEntries(entries) {
        entriesList.innerHTML = "";
        if (entries.length === 0) {
            const li = document.createElement("li");
            li.className = "no-entries";
            li.textContent = "No saved credentials for this site";
            entriesList.appendChild(li);
            return;
        }
        entries.forEach((entry) => {
            const li = document.createElement("li");
            li.className = "entry-item";
            li.dataset.id = entry.id;
            li.tabIndex = 0; // Keyboard navigation focus
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
            fillBtn.tabIndex = 0;
            fillBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                fillEntry(entry.id, fillBtn);
            });
            actionsDiv.appendChild(fillBtn);
            li.appendChild(actionsDiv);
            // Mouse click triggers autofill
            li.addEventListener("click", () => {
                fillEntry(entry.id, fillBtn);
            });
            // Keyboard press triggers autofill
            li.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    fillEntry(entry.id, fillBtn);
                }
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
                button.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = "";
                }, 1500);
            }
            else {
                button.textContent = "Error";
                button.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
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
