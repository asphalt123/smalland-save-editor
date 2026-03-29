const magicIdentifier = 0x9E2A83C1;

// Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const editorView = document.getElementById('editor-view');
const exportBtn = document.getElementById('export-btn');

// View elements
const elPlayerName = document.getElementById('edit-player-name');
const elSaveDate = document.getElementById('save-date-display');
const elGameVersion = document.getElementById('game-version-display');
const elInventoryList = document.getElementById('inventory-list');
const elInventoryCount = document.getElementById('inventory-count');

// Stats Elements
const elLevel = document.getElementById('edit-level');
const elExp = document.getElementById('edit-exp');
const elCharacterAttributes = document.getElementById('character-attributes-area');
const elEquipment = document.getElementById('equipment-render-area');

// Internal state
let nextInternalId = 0;
let loadedFileName = '';
let headerData = null; // Buffer before zlib chunks
let tailData = null;   // Buffer after zlib chunks
let currentSaveJson = null;
let zlibPrefixBytes = new Uint8Array([0x00, 0x9e, 0x01, 0x00]); // default placeholder

/* --- Parsing & Packing Logic --- */

// Tabs mapping
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
        
        btn.classList.add('active');
        document.getElementById(btn.getAttribute('data-tab')).style.display = 'block';
    });
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if(e.dataTransfer.files.length) {
        processFile(e.dataTransfer.files[0]);
    }
});
fileInput.addEventListener('change', (e) => {
    if(e.target.files.length) processFile(e.target.files[0]);
});

function processFile(file) {
    loadedFileName = file.name;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const buffer = e.target.result;
            await parseSaveFile(buffer);
            showToast('Save file loaded successfully!', 'success');
        } catch(err) {
            console.error(err);
            showToast('Failed to parse save file: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

async function parseSaveFile(buffer) {
    const dv = new DataView(buffer);
    if(dv.getUint32(0, true) !== magicIdentifier) {
        throw new Error("Invalid Smalland save format. Expected UE4 compressed chunk.");
    }

    const bytes = new Uint8Array(buffer);
    let uncompressedParts = [];
    let currentOffset = 0;
    
    while(currentOffset + 48 <= bytes.length) {
        let dvChunk = new DataView(bytes.buffer, bytes.byteOffset + currentOffset);
        if(dvChunk.getUint32(0, true) !== magicIdentifier) {
            break; // No more chunks, reached the signature tail!
        }
        let compSize = Number(dvChunk.getBigUint64(16, true));
        let chunkZlibStart = currentOffset + 48;
        
        let zlibData = bytes.slice(chunkZlibStart, chunkZlibStart + compSize);
        try {
            uncompressedParts.push(pako.inflate(zlibData));
        } catch(err) {
            throw new Error("Zlib decompression failed on chunk! Error: " + err);
        }
        currentOffset = chunkZlibStart + compSize;
    }

    if(uncompressedParts.length === 0) throw new Error("Could not parse any chunks.");
    
    tailData = bytes.slice(currentOffset);
    
    let totalLen = uncompressedParts.reduce((acc, val) => acc + val.length, 0);
    let uncompressed = new Uint8Array(totalLen);
    let uncompOffset = 0;
    for(let p of uncompressedParts) {
        uncompressed.set(p, uncompOffset);
        uncompOffset += p.length;
    }

    // Now parse the uncompressed string structure
    const uncompressedDv = new DataView(uncompressed.buffer);
    
    // Cache the first 4 bytes just in case Smalland uses them directly
    zlibPrefixBytes = uncompressed.slice(0, 4);

    // Let's find the explicit "SMALLAND_PLAYER" string
    let jsonStart = -1;
    let utf16Length = 0;
    
    for(let i=0; i<uncompressed.length - 16; i++) {
        const slice = uncompressed.slice(i, i+15);
        const str = new TextDecoder().decode(slice);
        if(str === "SMALLAND_PLAYER") {
            // Next byte is null terminator
            // Then 4 bytes for string length (-utf16 chars)
            const lengthOffset = i + 16;
            const lengthInt = uncompressedDv.getInt32(lengthOffset, true);
            
            if (lengthInt < 0) {
                utf16Length = -lengthInt;
                jsonStart = lengthOffset + 4;
            }
            break;
        }
    }

    if(jsonStart === -1) throw new Error("Could not find SMALLAND_PLAYER identifier.");

    // Extract UTF-16 JSON String
    const jsonByteLen = utf16Length * 2;
    let jsonBytes = uncompressed.slice(jsonStart, jsonStart + jsonByteLen);
    
    // Remove null terminator if present
    if(jsonBytes[jsonBytes.length - 2] === 0 && jsonBytes[jsonBytes.length - 1] === 0) {
        jsonBytes = jsonBytes.slice(0, jsonBytes.length - 2);
    }

    const text = new TextDecoder('utf-16le').decode(jsonBytes);
    
    try {
        currentSaveJson = JSON.parse(text);
        renderEditor(currentSaveJson);
    } catch(err) {
        throw new Error("Failed to parse inner JSON: " + err.message);
    }
}

function generateNextId(data) {
    if(nextInternalId === 0) {
        for(let k in data.Serialize) {
            let num = parseInt(k, 10);
            if(num > nextInternalId) nextInternalId = num;
        }
    }
    nextInternalId++;
    return nextInternalId;
}

function renderEditor(data) {
    dropzone.classList.add('hidden');
    editorView.classList.remove('hidden');

    elPlayerName.value = data.PlayerName || "Unknown Player";
    elSaveDate.textContent = data.TimeSaved || "N/A";

    renderInventory(data);
    renderProgression(data);
    renderEquipment(data);
    renderCreatures(data);
}

function renderInventory(data) {
    elInventoryList.innerHTML = '';
    const inventory = data.Preserialize?.PlayerInventory?.InventoryItems || [];
    elInventoryCount.textContent = `${inventory.length} items`;
    
    if (inventory.length === 0) {
        elInventoryList.innerHTML = `<tr><td colspan="2" style="text-align:center; color: var(--text-secondary)">No items found.</td></tr>`;
        return;
    }

    inventory.forEach((item, index) => {
        const tr = document.createElement('tr');
        
        // Ex: /Game/Items/Resources/BPI_Fiber.BPI_Fiber_C -> BPI_Fiber
        let niceName = item.Class ? item.Class.split('/').pop().split('.')[0] : "Unknown";
        niceName = niceName.replace('BPI_', '').replace('_C', '').replace(/_/g, ' ');

        const idStr = item.Id.toString();
        const serializeData = (data.Serialize && data.Serialize[idStr]) ? data.Serialize[idStr] : {};
        
        // Check if item has Durability but no Quantity
        const isWeapon = serializeData.Durability !== undefined && serializeData.Quantity === undefined;
        let displayVal = isWeapon ? serializeData.Durability : (serializeData.Quantity || 1);

        tr.innerHTML = `
            <td>
                <div class="item-name">${niceName}</div>
                <div class="item-class" style="word-break:break-all; font-size:0.75rem">${item.Class}</div>
            </td>
            <td>
                <div style="font-size:0.7rem; color: var(--text-secondary)">${isWeapon ? 'Durability' : 'Quantity'}</div>
                <input type="number" class="premium-input count-input" min="${isWeapon ? '0' : '1'}" step="${isWeapon ? '0.1' : '1'}" value="${displayVal}" data-index="${index}" style="width:80px; padding:0.25rem 0.5rem;" />
            </td>
            <td style="display:flex; gap:0.5rem; justify-content:center; align-items:center; height:100%">
                <button class="btn btn-secondary btn-copy" style="padding:0.25rem 0.5rem; font-size:0.8rem">Copy</button>
                <button class="btn btn-secondary btn-remove" style="padding:0.25rem 0.5rem; font-size:0.8rem; border-color:rgba(239,68,68,0.3); color:#fca5a5">Rem</button>
            </td>
        `;

        tr.querySelector('.count-input').addEventListener('change', (e) => {
            const num = isWeapon ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            if(!isNaN(num)) {
                if(!data.Serialize) data.Serialize = {};
                if(!data.Serialize[idStr]) data.Serialize[idStr] = {};
                if(isWeapon) {
                    data.Serialize[idStr].Durability = num;
                } else {
                    data.Serialize[idStr].Quantity = num;
                }
            }
        });
        
        // Remove Action
        tr.querySelector('.btn-remove').addEventListener('click', () => {
            // Remove from Preserialize Inventories array
            inventory.splice(index, 1);
            // Remove from inner Serialize loop
            let serInv = data.Serialize[data.Preserialize.PlayerInventory.Id].InventoryItems;
            let serIndex = serInv.findIndex(el => el.Id === item.Id);
            if(serIndex !== -1) serInv.splice(serIndex, 1);
            
            // Delete actual object
            delete data.Serialize[idStr];
            
            renderInventory(data);
        });

        // Copy Action
        tr.querySelector('.btn-copy').addEventListener('click', () => {
            let nId = generateNextId(data);
            
            // Add to Preserialize
            inventory.push({ Class: item.Class, Id: nId });
            
            // Add to inner Serialize array
            let serInv = data.Serialize[data.Preserialize.PlayerInventory.Id].InventoryItems;
            serInv.push({ Id: nId, Idx: serInv.length });
            
            // Clone physical state
            if(data.Serialize[idStr]) {
                data.Serialize[nId.toString()] = JSON.parse(JSON.stringify(data.Serialize[idStr]));
            }
            
            renderInventory(data);
        });

        elInventoryList.appendChild(tr);
    });
}

function renderProgression(data) {
    const progId = data.Preserialize?.PlayerProgression?.Id;
    const progression = progId ? data.Serialize[progId] : null;

    if(!progression) return;
    
    elLevel.value = progression.Level || 1;
    elExp.value = progression.XP || 0;
    
    const attributes = progression.Attributes || {};
    if (elCharacterAttributes) {
        elCharacterAttributes.innerHTML = '';
        if(Object.keys(attributes).length === 0) {
            elCharacterAttributes.innerHTML = '<span class="badge">No attributes found</span>';
        } else {
            for(let key in attributes) {
                let niceKey = key.replace('CA_Player_', '').replace('CA_', '');
                let row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.innerHTML = `
                    <label style="font-size:0.85rem">${niceKey}</label>
                    <input type="number" class="premium-input" style="width:60px; padding:0.25rem; font-size:0.85rem; text-align:center" value="${attributes[key]}" />
                `;
                row.querySelector('input').addEventListener('change', e => {
                    let v = parseInt(e.target.value, 10);
                    if(!isNaN(v)) attributes[key] = v;
                });
                elCharacterAttributes.appendChild(row);
            }
        }
    }

    const setupListener = (el, key) => {
        if(el) el.addEventListener('change', (e) => {
            const num = parseInt(e.target.value, 10);
            if(!isNaN(num)) progression[key] = num;
        });
    };

    setupListener(elLevel, 'Level');
    setupListener(elExp, 'XP');
}

function renderEquipment(data) {
    elEquipment.innerHTML = '';
    const equipment = data.Preserialize?.PlayerEquipment?.EquippedItems || [];
    
    if (equipment.length === 0) {
        elEquipment.innerHTML = `<span class="badge">No Equipment Active</span>`;
        return;
    }

    equipment.forEach((item) => {
        let niceName = item.Class ? item.Class.split('/').pop().split('.')[0] : "Unknown";
        niceName = niceName.replace('BPI_', '');
        
        const dv = document.createElement('div');
        dv.className = 'glass-card';
        dv.style.padding = '0.75rem';
        dv.style.marginBottom = '0.5rem';
        dv.innerHTML = `
            <strong style="color:var(--accent-primary)">${niceName}</strong>
            <div class="item-class" style="margin-top:0.25rem">${item.Class}</div>
        `;
        elEquipment.appendChild(dv);
    });
}

function renderCreatures(data) {
    const elCreatures = document.getElementById('creatures-list');
    const elCount = document.getElementById('creatures-count');
    elCreatures.innerHTML = '';
    
    const stableId = data.Preserialize?.CreatureStable?.Id;
    if(!stableId || !data.Serialize[stableId]) {
        elCount.textContent = "0 tamed";
        return;
    }
    
    const stable = data.Serialize[stableId];
    let arr = stable.SerializedAnimalEntries || stable.Creatures || [];
    elCount.textContent = `${arr.length} tamed`;
    
    if(arr.length === 0) {
        elCreatures.innerHTML = `<div style="grid-column: span 2; text-align:center; color:#a1a1aa">No creatures found.</div>`;
        return;
    }

    arr.forEach((entry, index) => {
        let spawnInfo, progId, localSerialize;
        
        if(entry.SerializedAnimal) {
             spawnInfo = entry.SerializedAnimal.CreatureEntry?.SpawnInfo;
             progId = entry.SerializedAnimal.CreatureEntry?.PreSerialize?.CharProgression?.Id;
             localSerialize = entry.SerializedAnimal.Serialize || {};
        } else {
             spawnInfo = entry.SpawnInfo;
             progId = entry.PreSerialize?.CharProgression?.Id;
             localSerialize = data.Serialize;
        }

        if(!spawnInfo) return;
        
        let niceName = spawnInfo.Class ? spawnInfo.Class.split('/').pop().split('.')[0] : "Creature";
        niceName = niceName.replace('BP_', '').replace('_C', '');
        
        let progData = (progId && localSerialize[progId]) ? localSerialize[progId] : {};
        let level = progData.Level || 1;
        let cName = progData.Name || "Unnamed";
        let atts = progData.Attributes || {};

        const div = document.createElement('div');
        div.className = 'glass-card creature-card';
        div.innerHTML = `
            <div class="creature-card-header">
                <div class="form-group" style="flex: 1; min-width: 0;">
                    <label>Creature Name</label>
                    <input type="text" class="premium-input c-name" value="${cName}" style="width: 100%; font-weight: 600;" />
                </div>
                <span class="badge" style="margin-top: 1.6rem; white-space: nowrap;">${niceName}</span>
            </div>
            
            <div class="creature-stats-grid">
                <div class="form-group">
                    <label>Level</label>
                    <input type="number" class="premium-input c-level" value="${level}" min="1" />
                </div>
                <div class="form-group">
                    <label>XP</label>
                    <input type="number" class="premium-input c-xp" value="${progData.XP || 0}" min="0" />
                </div>
            </div>
            
            <div class="form-group">
                <label>Creature Attributes</label>
                <div class="creature-attributes-list">
                    <!-- Attributes injected here -->
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: auto;">
               <button class="btn btn-primary btn-copy">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    Clone
               </button>
               <button class="btn btn-danger btn-remove">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Remove
               </button>
            </div>
        `;
        
        const attsContainer = div.querySelector('.creature-attributes-list');
        for(let ak in atts) {
            const row = document.createElement('div');
            row.className = 'attribute-row';
            const shortKey = ak.replace('CA_Animal_', '').replace('CA_', '');
            row.innerHTML = `
                <span>${shortKey}</span>
                <input type="number" value="${atts[ak]}" />
            `;
            row.querySelector('input').addEventListener('change', e => {
                 let v = parseInt(e.target.value, 10);
                 if(!isNaN(v)) progData.Attributes[ak] = v;
            });
            attsContainer.appendChild(row);
        }

        if (Object.keys(atts).length === 0) {
            attsContainer.innerHTML = '<span style="grid-column: 1/-1; font-size: 0.8rem; text-align: center; color: var(--text-secondary);">No stats available</span>';
        }

        // Setup base listeners
        div.querySelector('.c-name').addEventListener('change', e => { progData.Name = e.target.value; });
        div.querySelector('.c-level').addEventListener('change', e => { progData.Level = parseInt(e.target.value); });
        div.querySelector('.c-xp').addEventListener('change', e => { progData.XP = parseInt(e.target.value); });

        // Action listeners
        div.querySelector('.btn-remove').addEventListener('click', () => {
             arr.splice(index, 1);
             renderCreatures(data);
        });
        
        div.querySelector('.btn-copy').addEventListener('click', () => {
             let newEntry = JSON.parse(JSON.stringify(entry));
             let localSer = newEntry.SerializedAnimal ? newEntry.SerializedAnimal.Serialize : null;
             
             function assignNewIds(obj) {
                 if(!obj || typeof obj !== 'object') return;
                 if(obj.Id !== undefined) {
                     let oldIdStr = obj.Id.toString();
                     let nId = generateNextId(data);
                     obj.Id = nId;
                     
                     if(localSer && localSer[oldIdStr]) {
                         localSer[nId.toString()] = JSON.parse(JSON.stringify(localSer[oldIdStr]));
                         delete localSer[oldIdStr];
                         assignNewIds(localSer[nId.toString()]);
                     } else if (data.Serialize[oldIdStr]) {
                         data.Serialize[nId.toString()] = JSON.parse(JSON.stringify(data.Serialize[oldIdStr]));
                         assignNewIds(data.Serialize[nId.toString()]);
                     }
                 }
                 for(let k in obj) {
                     if(k !== 'Id' && typeof obj[k] === 'object') assignNewIds(obj[k]);
                 }
             }
             assignNewIds(newEntry);
             
             arr.push(newEntry);
             renderCreatures(data);
        });

        elCreatures.appendChild(div);
    });
}

exportBtn.addEventListener('click', () => {
    try {
        currentSaveJson.PlayerName = elPlayerName.value;
        const packed = generateRepackedBlob();
        downloadBlob(packed, "EDITOR_" + loadedFileName);
        showToast('Successfully packed and downloaded save!', 'success');
    } catch(err) {
        console.error(err);
        showToast('Failed to pack save sequence: ' + err.message, 'error');
    }
});

function generateRepackedBlob() {
    // Stringify JSON
    const jsonStr = JSON.stringify(currentSaveJson);
    
    // Create UTF-16 LE bytes plus null terminator
    const strArray = new Uint16Array(jsonStr.length + 1);
    for (let i = 0; i < jsonStr.length; i++) {
        strArray[i] = jsonStr.charCodeAt(i);
    }
    strArray[jsonStr.length] = 0; // null char
    const utf16Bytes = new Uint8Array(strArray.buffer);
    
    // String length prefix is -(chars count including null)
    const charCount = jsonStr.length + 1;
    
    // Build uncompressed block
    // [00 9E 01 00]? We dynamically reconstruct it.
    // wait, actually we append SMALLAND_PLAYER to it.
    
    // Let's use the exact prefix length based on our reading
    // It's 4 bytes of zlibPrefixBytes
    // + 4 bytes of `10 00 00 00` (length 16)
    // + 16 chars "SMALLAND_PLAYER\0"
    // + 4 bytes encoding length (-charCount)
    // + utf16Bytes
    
    let offset = 0;
    const prefixLen = 4 + 4 + 16 + 4;
    const uncompressedData = new Uint8Array(prefixLen + utf16Bytes.length);
    const uncompDv = new DataView(uncompressedData.buffer);
    
    // First 4 mysterious bytes (could be size, maybe not, we just write what we read originally if we want to be safe)
    // Actually, safer is to just write the ones we extracted exactly (zlibPrefixBytes)
    uncompressedData.set(zlibPrefixBytes, offset); offset += 4;
    
    uncompDv.setInt32(offset, 16, true); offset += 4;
    
    const ident = new TextEncoder().encode("SMALLAND_PLAYER\x00");
    uncompressedData.set(ident, offset); offset += 16;
    
    uncompDv.setInt32(offset, -charCount, true); offset += 4;
    
    uncompressedData.set(utf16Bytes, offset);
    
    // Split into 131072 byte chunks
    let compressedChunks = [];
    const maxChunkSize = 131072;
    
    for(let i = 0; i < uncompressedData.length; i += maxChunkSize) {
        let chunkUncomp = uncompressedData.slice(i, i + maxChunkSize);
        let chunkComp = pako.deflate(chunkUncomp);
        
        let header = new Uint8Array(48);
        let hdDv = new DataView(header.buffer);
        hdDv.setUint32(0, magicIdentifier, true);
        hdDv.setUint32(4, 0, true);
        hdDv.setBigUint64(8, BigInt(maxChunkSize), true);
        hdDv.setBigUint64(16, BigInt(chunkComp.length), true);
        hdDv.setBigUint64(24, BigInt(chunkUncomp.length), true);
        hdDv.setBigUint64(32, BigInt(chunkComp.length), true);
        hdDv.setBigUint64(40, BigInt(chunkUncomp.length), true);
        
        compressedChunks.push({ header, data: chunkComp });
    }
    
    // Reconstruct final file
    let totalSize = tailData.length;
    for(let c of compressedChunks) totalSize += c.header.length + c.data.length;
    
    const finalBuffer = new Uint8Array(totalSize);
    let finalOffset = 0;
    for(let c of compressedChunks) {
        finalBuffer.set(c.header, finalOffset); finalOffset += c.header.length;
        finalBuffer.set(c.data, finalOffset); finalOffset += c.data.length;
    }
    finalBuffer.set(tailData, finalOffset);
    
    return finalBuffer;
}

function downloadBlob(buffer, filename) {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // SVG icons
    const icon = type === 'success' 
        ? `<svg width="20" height="20" fill="none" class="icon" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg>`
        : `<svg width="20" height="20" fill="none" class="icon" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    
    toast.innerHTML = `${icon} <span>${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}
