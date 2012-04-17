// VARIABLES
History        = window.History,
document       = window.document,
text_title     = document.getElementById('text-title'),
text_content   = document.getElementById('text-content'),
saveInterval   = 1000,
draftsItems    = $('#drafts ul').data('items'),
publishedItems = $('#published ul').data('items'),
col_height     = 0,
divTimeout     = null,
curPath        = window.location.pathname.split('/'),
showdown       = new Showdown.converter(),
lineHeight     = $('#line-height').height(),
commandPressed = false,
previewHeight  = 0,
hideBarTimeout = null,
scrollTimeout  = null;

// Elements
var el = fn.getjQueryElements({
  section   : '.split-section',
  published : '#published',
  drafts    : '#drafts',
  admin     : '#admin',
  editor    : '#post-editor',
  title     : '#post_title',
  content   : '#post_content',
  slug      : '#post_slug',
  url       : '#post_url',
  draft     : '#post_draft',
  save      : '#save-button',
  form      : '#new_post,.edit_post',
  bar       : '#bar',
  curCol    : '#drafts',
  curColUl  : '#drafts ul',
  curItem   : '.col li:visible:first',
  blog      : '#blog-button',
  publish   : '#publish-button',
  preview   : '#post-preview'
});

// Editor state variables
var state = {
  post         : null,
  preview      : false,
  changed      : false,
  editing      : false,
  beganEditing : false,
  barHidden    : false,
  barPinned    : false,
  saving       : false,
  lastKey      : 0,
  lines        : 0,
  colIndex     : 0,
  itemIndex    : [0, 0]
};

// Allows for auto expanding textareas
function makeExpandingArea(container) {
  var area = container.querySelector('textarea'),
      span = container.querySelector('span');

 if (area.addEventListener) {
   area.addEventListener('input', function makeExpandingAreaCallback() {
     span.textContent = area.value;
   }, false);
   span.textContent = area.value;
 } else if (area.attachEvent) {
   // IE8 compatibility
   area.attachEvent('onpropertychange', function makeExpandingAreaCallback() {
     span.innerText = area.value;
   });
   span.innerText = area.value;
 }

 // Enable extra CSS
 container.className += ' active';
}

function makeExpandingAreas() {
  makeExpandingArea(text_title);
  makeExpandingArea(text_content);
}

// Lets us get the caret position in textarea
function getCaret(el) {
  if (el.selectionStart) {
    return el.selectionStart;
  } else if (document.selection) {
    el.focus();

    var r = document.selection.createRange();
    if (r == null) {
      return 0;
    }

    var re = el.createTextRange(),
        rc = re.duplicate();
    re.moveToBookmark(r.getBookmark());
    rc.setEndPoint('EndToStart', re);

    return rc.text.length;
  }
  return 0;
}

function filterTitle(objects, val) {
  return objects.filter(function filterTitleObjects(el) {
    var regex = new RegExp(val.split('').join('.*'), 'i');
    if (el.title.match(regex)) return true;
  }).map(function filterTitleMap(el) {
    return el.id;
  });
}

function showOnly(context,selectors) {
  $(context).addClass('hidden').filter(selectors).removeClass('hidden');
}

// Set post content height and column height
function setHeights() {
  var content_height = Math.max($(window).height() - el.title.height()-40,100);
  col_height = $(window).height()-120;
  $('.col ul').css('height', col_height);
  el.content.css('min-height', content_height);
  $('#content-fieldset').css('height', content_height);
  return col_height;
}

// Highlight an item in the column
function selectItem(object, items) {
  fn.log(object);
  el.curItem.removeClass('selected');
  // We can pass the index
  if (typeof object == 'number') {
    var item = $(items).eq(object);
    el.curItem = item.length ? item : $(items).last();
    el.curItem.addClass('selected');
  }
  // Or the actual item
  else {
    el.curItem = object.addClass('selected');
  }
  return el.curItem.index();
}


// Highlight the proper column
function changeCol() {
  el.curItem.removeClass('selected');

  // to Drafts
  if (el.curCol.is('#published')) {
    state.colIndex = 0;
    el.published.removeClass('active');
    el.curCol = el.drafts.addClass('active');
  }
  // to Published
  else {
    state.colIndex = 1;
    el.drafts.removeClass('active');
    el.curCol = el.published.addClass('active');
  }

  el.curItem = el.curCol.find('li:visible:eq('+state.itemIndex[state.colIndex]+')').addClass('selected');
  el.curColUl = el.curCol.find('ul');
}

// Saves the post
function savePost(callback) {
  state.saving = true;
  state.changed = false;
  el.save.addClass('saving');
  fn.log('Saving',el.draft);

  // POST
  $.ajax({
    type: 'POST',
    url: el.form.attr('action'),
    data: el.form.serialize(),
    dataType: 'text',
    success: function savingSuccess(data) {
      var data = JSON.parse(data),
          li   = $('#post-'+data.id),
          list = (data.draft == 'false') ? $('#drafts ul') : $('#published ul');

      // Update state
      state.saving = false;

      // Update publish button
      el.save.removeClass('saving dirty').addClass('saved');
      setTimeout(function(){el.save.removeClass('saved')},1000);

      // Update cache and post data
      setCache(data.id, data);
      state.post = data;

      // Update form
      setFormAction('/edit/'+state.post.id);
      updateDraftButton(state.post.draft);

      // If item exists move to top, else add to top
      if (li.length) li.prependTo(list);
      else {
        $('#drafts ul').prepend('<li id="post-'+state.post.id+'"><a href="">'+el.title.val()+'</a></li>');
      }

      fn.log('Saved',data.id,data);
      if (callback) callback.call(this, data);
    }
  });
}

// Get cache
function getCache(id) {
  var string = localStorage.getItem(id);
  return JSON.parse(string);
}

// Set cache
function setCache(id, data) {
  localStorage.setItem(id,JSON.stringify(data));
}

// Load it up
function loadCache(id, callback) {
  var cache = getCache(id);
  if (cache) {
    callback.call(this, cache);
  } else {
    $.getJSON('/get/'+id, function loadCacheCallback(data) {
      setCache(id, data);
      callback.call(this, data);
    });
  }
}

// Enter editor, val can be true, false, or the ID
//   true = editing a new post
//   false = exit editor
//   id = start editing id
function setEditing(val, callback) {
  fn.log('Set editing', val);
  if (val !== false) {
    // Update UI
    el.admin.addClass('editing');
    el.bar.addClass('transition').removeClass('hidden');
    state.editing = true;
    showBar(true);

    // If true, start editing a new post
    if (val === true) {
      pushState('/new');
      setFormAction('/posts');
    }
    // Editing post id = val
    else {
      loadCache(val, function setEditingLoadCache(data) {
        fn.log('got data', data);
        // Set state variables
        state.post = data;

        // Set form attributes
        el.content.val(state.post.content);
        el.slug.val(state.post.slug);
        el.url.val(state.post.url);
        setDraft(state.post.draft);

        // Refresh form
        makeExpandingAreas();
        scrollToPosition();

        // Update url and form
        var url = '/edit/'+state.post.id;
        setFormAction(url);
        pushState(url+window.location.hash);

        // Update link to post
        el.blog.attr('href',window.location.protocol+'//'+window.location.host+'/'+state.post.slug).attr('target','_blank');

        // Callbacks
        if (callback) callback.call(this, data);
      });
    }
  }
  else {
    // Save before closing
    if (state.changed) savePost();

    // Update state
    state.editing = false;
    state.beganEditing = false;

    // Clear form
    el.title.val('').focus();
    el.content.val('');
    makeExpandingAreas();

    // Update UI
    el.blog.attr('href','/').removeAttr('target');
    el.bar.removeClass('transition');
    el.admin.removeClass('preview editing');
    delayedHideBar();

    // Update URL
    pushState('/admin');
  }
}

function pushState(url) {
  History.pushState(state, url.split('/')[0], url);
}

// Set form action
function setFormAction(url) {
  el.form.attr('action',url);
}

// Either uses cache or loads post
function editSelectedItem(callback) {
  var id = el.curItem.attr('id').split('-')[1];
  // If they click on "New Draft..."
  if (id == 0) {
    var edit = true;
  } else {
    el.title.val(el.curItem.find('a').html());
    var edit = id;
  }
  setEditing(edit, function editSelectedItemCallback() {
    if (callback) callback.call();
  });
}

function setDraft(draft) {
  setDraftInput(draft);
  updateDraftButton(draft);
}

function setDraftInput(draft) {
  fn.log(draft);
  el.draft.attr('value',(draft ? 1 : 0));
  el.draft.attr('checked',(draft ? 'checked' : ''));
}

function updateDraftButton(draft) {
  fn.log(draft);
  if (draft) el.publish.html('Draft').addClass('icon-edit').removeClass('icon-check');
  else       el.publish.html('Published').removeClass('icon-edit').addClass('icon-check');
}

// Preview
function updatePreviewPosition() {
  if (state.preview) {
    var textareaOffset = el.content.offset().top,
        lineOffset     = parseInt((-textareaOffset)/lineHeight,10),
        percentDown    = lineOffset / state.lines,
        previewOffset  = previewHeight * percentDown;

    el.preview.scrollTop(previewOffset);
  }
}

// Markdown preview
function updatePreview() {
  var title = el.title.val().split("\n").join('<br />');
  $('#post-preview .inner').html('<h1>'+(title ? title : 'No Title')+'</h1>'+showdown.makeHtml(el.content.val()));
  state.lines   = el.content.height()/lineHeight;
  previewHeight = $('#post-preview .inner').height();
}

function togglePreview() {
  if (state.preview) hidePreview();
  else showPreview();
}

function hidePreview() {
  pushState('/edit');
  pushState('/edit/'+state.post.id);
  el.admin.removeClass('preview');
  $('#preview-button').removeClass('icon-eye-close').addClass('icon-eye-open');
  state.preview = false;
}

function showPreview() {
  updatePreview();
  window.location.hash = 'preview';
  el.admin.addClass('preview');
  makeExpandingAreas();
  $('#preview-button').removeClass('icon-eye-open').addClass('icon-eye-close');
  state.preview = true;
}

function toggleBar() {
  state.barPinned = !state.barPinned;
  $.cookie('barPinned',state.barPinned);
  if (state.barPinned) showBar(true);
  else showBar(false);
}

function showBar(yes) {
  state.barHidden = !yes;
  if (yes) {
    clearTimeout(hideBarTimeout);
    el.bar.removeClass('hidden');
  }
  else if (!state.barPinned && !el.bar.is(':hover')) {
    el.bar.addClass('hidden');
  }
}

function delayedHideBar(time) {
  clearTimeout(hideBarTimeout);
  hideBarTimeout = setTimeout(function(){showBar(false)},(time ? time : 1000));
}

function savePosition() {
  clearTimeout(scrollTimeout);
  if (state.editing) {
    scrollTimeout = setTimeout(function() {
      $.cookie('position-'+state.post.id,el.editor.scrollTop());
    },1000);
  }
}

// Scroll to bottom of content and select the end
function scrollToPosition() {
  var cookie = $.cookie('position-'+state.post.id);
  fn.log('Scroll to position',cookie);
  if (cookie) el.editor.scrollTop(cookie);
  else {
    // Scroll to bottom
    el.content.focus().putCursorAtEnd();
    $('#post-editor').scrollTop(el.content.height());
  }
}

function heartbeatLogger() {
  fn.log('State:',state,'Elements',el);
}