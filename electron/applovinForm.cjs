// The JavaScript the upload automation runs INSIDE the upload page, as plain
// strings. It lives apart from main.cjs for one reason: scripts/applovin-check.mjs
// drives these very snippets against a mock upload form in headless Chrome, so the
// form handling can be tested without an AppLovin login. Change them here and both
// the app and the check follow.
//
// The form is external, so every selector is a heuristic: a row is a file input,
// the Iteration Name is the row's visible text field, and the two buttons are found
// by their label ("Add Another Upload", "Upload").

const j = JSON.stringify

/** Does the page have the buttons and inputs the automation needs? Reads only. */
function probeJs(addText, uploadText) {
  return `(function(){
      function has(t,exact){ t=t.toLowerCase(); return [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].some(function(el){var s=((el.innerText||el.value||'')+'').trim().toLowerCase(); return exact ? s===t : s.indexOf(t)>=0;}); }
      return {
        url: location.href,
        title: document.title,
        fileInputs: document.querySelectorAll('input[type=file]').length,
        textInputs: [...document.querySelectorAll('input[type=text], input:not([type])')].filter(function(el){return el.offsetParent!==null && !el.readOnly;}).length,
        addButton: has(${j(addText)}, false),
        uploadButton: has(${j(uploadText)}, true)
      };
    })()`
}

/** Click "Add Another Upload" until there are `count` rows. Returns the row count. */
function addRowsJs(count, addText) {
  return `(function(){
      function byText(t){ t=t.toLowerCase(); return [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].find(function(el){return ((el.innerText||el.value||'')+'').trim().toLowerCase().indexOf(t)>=0;}); }
      var target=${Number(count)}, guard=0;
      while(document.querySelectorAll('input[type=file]').length < target && guard < 60){ var b=byText(${j(addText)}); if(!b) break; b.click(); guard++; }
      return document.querySelectorAll('input[type=file]').length;
    })()`
}

/** Type the Iteration Names into the visible text fields. Returns how many it filled. */
function fillNamesJs(names) {
  return `(function(){
      var names=${j(names)};
      var texts=[...document.querySelectorAll('input[type=text], input:not([type])')].filter(function(el){return el.offsetParent!==null && !el.readOnly;});
      var k=Math.min(names.length, texts.length);
      for(var i=0;i<k;i++){ texts[i].value=names[i]; texts[i].dispatchEvent(new Event('input',{bubbles:true})); texts[i].dispatchEvent(new Event('change',{bubbles:true})); }
      return k;
    })()`
}

/** Click the page's Upload button (exact label match). True when one was found. */
function submitJs(uploadText) {
  return `(function(){
        function byText(t){ t=t.toLowerCase(); return [...document.querySelectorAll('button,a,input[type=button],input[type=submit]')].find(function(el){return ((el.innerText||el.value||'')+'').trim().toLowerCase()===t;}); }
        var b=byText(${j(uploadText)}); if(b){ b.click(); return true; } return false;
      })()`
}

/** Every http(s) URL on the page: anchors, text fields and plain text, in page order. */
function collectLinksJs(mark) {
  return `(function(){
    var mark=${j(String(mark || '').toLowerCase())}, out=[];
    function push(v){ v=(v||'').trim(); if(/^https?:/i.test(v) && (!mark || v.toLowerCase().indexOf(mark)>=0) && out.indexOf(v)<0) out.push(v); }
    document.querySelectorAll('a[href]').forEach(function(el){ push(el.href); push(el.textContent); });
    document.querySelectorAll('input, textarea').forEach(function(el){ push(el.value); });
    ((document.body && document.body.innerText) || '').split(/\\s+/).forEach(push);
    return out;
  })()`
}

/** The first result link after a submit, for targets that print just one (file server). */
function resultJs(selector, hrefIncludes) {
  return `(function(){
      var selector=${j(selector || '')};
      var hrefIncludes=${j(hrefIncludes || '')}.toLowerCase();
      function keep(url){
        if(!url || !/^https?:/i.test(url)) return false;
        return !hrefIncludes || url.toLowerCase().indexOf(hrefIncludes) >= 0;
      }
      function push(list, value){
        if(keep(value) && list.indexOf(value) < 0) list.push(value);
      }
      var out=[];
      if(selector){
        try {
          var picked=document.querySelector(selector);
          if(picked){
            push(out, picked.href || picked.value || picked.textContent || '');
          }
        } catch {}
      }
      document.querySelectorAll('a[href]').forEach(function(el){ push(out, el.href || ''); });
      document.querySelectorAll('input[type=text], input:not([type]), textarea').forEach(function(el){ push(out, el.value || ''); });
      var text=(document.body && document.body.innerText) || '';
      var matches=text.match(/https?:\\/\\/[^\\s"'<>]+/g) || [];
      matches.forEach(function(v){ push(out, v); });
      return { pageUrl: location.href, link: out[0] || '' };
    })()`
}

module.exports = { probeJs, addRowsJs, fillNamesJs, submitJs, collectLinksJs, resultJs }
