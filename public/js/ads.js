const Ads = (() => {
  // PHASE 5: Adscod Advertising enabled. This is strictly for display.
  // It DOES NOT grant premium unlocks.
  const ADS_ENABLED = true; 

  const api = async (path, options = {}) => { 
    const response = await fetch(`/api${path}`, { credentials: 'include', ...options }); 
    const data = await response.json().catch(() => ({})); 
    if (!response.ok || data.success === false) throw new Error(data.message || 'Sponsored message unavailable'); 
    return data; 
  };

  // Kept for backward compatibility to prevent console errors from old code
  async function refresh() { 
      return true; 
  }

  // Fetches and displays a sponsored message safely.
  async function showSponsoredMessage() {
    if (!ADS_ENABLED) {
        throw new Error('Sponsored messages are currently unavailable.');
    }
    
    try {
      // Fetch from our secure backend proxy
      const res = await api('/ads/serve');
      const adData = res.data;
      
      if (!adData || (!adData.imageUrl && !adData.videoUrl && !adData.adContent)) {
         throw new Error('No sponsored messages available right now.');
      }

      renderAdModal(adData);
    } catch (error) {
      throw new Error(error.message || 'Sponsored messages are currently unavailable.');
    }
  }

  // PHASE 5.1: RIGOROUS SAFE RENDERING IMPLEMENTATION
  function renderAdModal(adData) {
    const modal = document.createElement('div');
    modal.className = 'modal-root';
    modal.style.zIndex = '9999999';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal';
    modalContent.style.cssText = 'padding:0; overflow:hidden; background:#111; border:1px solid #333;';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding:10px 15px; background:#222; display:flex; justify-content:space-between; align-items:center;';
    header.innerHTML = '<span style="color:#999; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase;">Sponsored Message</span>';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.style.cssText = 'background:none; border:none; color:#fff; font-size:24px; cursor:pointer;';
    closeBtn.innerHTML = '&times;';
    // Security: Closes the modal without triggering an unlock
    closeBtn.onclick = () => modal.remove(); 
    
    header.appendChild(closeBtn);
    modalContent.appendChild(header);

    // Helper: Safely parse and validate URLs on the client
    function isValidHttpsUrl(urlStr) {
        if (!urlStr) return false;
        try {
            const parsed = new URL(urlStr);
            return parsed.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    // Media (Strict HTTPS Validation)
    if (adData.videoUrl && isValidHttpsUrl(adData.videoUrl)) {
       const video = document.createElement('video');
       video.src = adData.videoUrl;
       video.controls = true;
       video.autoplay = true;
       video.style.cssText = 'width:100%; max-height:300px; background:#000;';
       modalContent.appendChild(video);
    } else if (adData.imageUrl && isValidHttpsUrl(adData.imageUrl)) {
       const img = document.createElement('img');
       img.src = adData.imageUrl;
       img.style.cssText = 'width:100%; max-height:300px; object-fit:contain; background:#000;';
       modalContent.appendChild(img);
    } else if (adData.adContent) {
       // DOMParser Sanitization
       const parser = new DOMParser();
       const doc = parser.parseFromString(adData.adContent, 'text/html');
       
       const contentDiv = document.createElement('div');
       contentDiv.style.cssText = 'padding:10px; background:#fff; color:#000; max-height: 300px; overflow-y: auto;';
       
       // PHASE 5.1 FIX: Recursive DOM Sanitizer
       // Eliminates event handlers (onerror), unsafe tags (svg, script), and javascript: schemes.
       function sanitizeAndAppend(sourceNode, targetNode) {
           const safeTags = ['B','I','U','STRONG','EM','P','BR','DIV','SPAN','A','IMG','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE'];
           
           for (let i = 0; i < sourceNode.childNodes.length; i++) {
               const child = sourceNode.childNodes[i];
               
               if (child.nodeType === Node.TEXT_NODE) {
                   targetNode.appendChild(document.createTextNode(child.textContent));
               } else if (child.nodeType === Node.ELEMENT_NODE) {
                   const tagName = child.tagName.toUpperCase();
                   if (!safeTags.includes(tagName)) continue; // Drop unsafe tags

                   const el = document.createElement(tagName);
                   
                   // Sanitize attributes
                   for (let j = 0; j < child.attributes.length; j++) {
                       const attr = child.attributes[j];
                       const name = attr.name.toLowerCase();
                       const val = attr.value;
                       
                       // Block event handlers entirely
                       if (name.startsWith('on')) continue;
                       
                       // Validate URLs
                       if (name === 'href' || name === 'src') {
                           try {
                               const parsed = new URL(val, window.location.origin);
                               if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
                           } catch(e) { continue; }
                       }
                       
                       el.setAttribute(name, val);
                   }
                   
                   // Security for links to prevent Reverse Tabnabbing
                   if (tagName === 'A') {
                       el.setAttribute('target', '_blank');
                       el.setAttribute('rel', 'noopener noreferrer'); 
                   }
                   
                   // Recurse children
                   sanitizeAndAppend(child, el);
                   targetNode.appendChild(el);
               }
           }
       }
       
       sanitizeAndAppend(doc.body, contentDiv);
       modalContent.appendChild(contentDiv);
    }

    // Body & Text (Safe textContent)
    const body = document.createElement('div');
    body.style.padding = '20px';
    
    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 10px 0; color:#fff;';
    title.textContent = adData.title || 'Sponsored Content';
    body.appendChild(title);

    const desc = document.createElement('p');
    desc.style.cssText = 'color:#ccc; font-size:14px; margin:0 0 20px 0;';
    desc.textContent = adData.description || '';
    body.appendChild(desc);

    // Click URL (Strict Parsing Validation & Tabnabbing Fix)
    if (isValidHttpsUrl(adData.clickUrl)) {
       const link = document.createElement('a');
       link.href = adData.clickUrl;
       link.target = '_blank';
       // PHASE 5.1 FIX: Prevent Reverse Tabnabbing
       link.rel = 'noopener noreferrer'; 
       link.className = 'button button-primary';
       link.style.cssText = 'display:block; text-align:center; text-decoration:none;';
       link.textContent = 'Learn More';
       body.appendChild(link);
    }

    modalContent.appendChild(body);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
  }

  return { 
      refresh, 
      showSponsoredMessage, 
      get isEnabled() { return ADS_ENABLED; } 
  };
})();

window.AfroStoryAds = Ads;
