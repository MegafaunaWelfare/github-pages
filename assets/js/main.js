(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  /* Mobile navigation ---------------------------------------------------- */

  function setNavOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      setNavOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setNavOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setNavOpen(false);
        toggle.focus();
      }
    });

    document.addEventListener('click', function (event) {
      if (nav.classList.contains('is-open') && !header.contains(event.target)) {
        setNavOpen(false);
      }
    });
  }

  /* Header shadow once the page scrolls ---------------------------------- */

  function onScroll() {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Reveal sections as they enter the viewport --------------------------- */

  var revealEls = document.querySelectorAll('.reveal');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!('IntersectionObserver' in window) || reduceMotion) {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* Scrolling card rails: previous / next buttons ------------------------ */

  document.querySelectorAll('[data-rail]').forEach(function (wrap) {
    var rail = wrap.querySelector('.rail');
    var prev = wrap.querySelector('[data-rail-prev]');
    var next = wrap.querySelector('[data-rail-next]');
    if (!rail || !prev || !next) return;

    function step() {
      var item = rail.querySelector('li');
      var gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
      return item ? item.getBoundingClientRect().width + gap : rail.clientWidth * 0.8;
    }

    function update() {
      var max = rail.scrollWidth - rail.clientWidth - 2;
      prev.disabled = rail.scrollLeft <= 2;
      next.disabled = rail.scrollLeft >= max;
    }

    prev.addEventListener('click', function () {
      rail.scrollBy({ left: -step(), behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    next.addEventListener('click', function () {
      rail.scrollBy({ left: step(), behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    rail.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });

  /* In-page section menu: highlight the section in view ------------------ */

  var subnavLinks = document.querySelectorAll('.subnav a[href^="#"]');
  var subnavTargets = Array.prototype.map.call(subnavLinks, function (link) {
    return document.querySelector(link.getAttribute('href'));
  }).filter(Boolean);

  if (subnavTargets.length) {
    var subnavList = document.querySelector('.subnav ul');
    var currentId = null;
    var ticking = false;

    // The current section is the last one whose top has passed 40% of the
    // way down the screen. Above the first section, nothing is highlighted.
    function updateSubnav() {
      ticking = false;
      var line = window.innerHeight * 0.4;
      var current = null;
      subnavTargets.forEach(function (section) {
        if (section.getBoundingClientRect().top <= line) current = section.id;
      });
      if (current === currentId) return;
      currentId = current;
      if (!current && subnavList.scrollLeft) subnavList.scrollTo({ left: 0 });

      subnavLinks.forEach(function (link) {
        var active = link.getAttribute('href') === '#' + current;
        link.classList.toggle('is-active', active);

        // On narrow screens the menu scrolls sideways: keep the active link in view.
        if (active && subnavList.scrollWidth > subnavList.clientWidth) {
          var offset = link.getBoundingClientRect().left - subnavList.getBoundingClientRect().left;
          subnavList.scrollTo({ left: subnavList.scrollLeft + offset - 16, behavior: reduceMotion ? 'auto' : 'smooth' });
        }
      });
    }

    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(updateSubnav);
      }
    }, { passive: true });
    updateSubnav();
  }

  /* Contact form: compose an email in the visitor's mail app ------------- */

  var form = document.getElementById('contact-form');

  if (form) {
    var topicSelect = form.querySelector('[name="topic"]');
    var errorEl = document.getElementById('cf-error');

    // Links such as contact.html?topic=Volunteering pre-select the topic.
    var params = new URLSearchParams(window.location.search);
    var wanted = params.get('topic');
    if (wanted) {
      Array.prototype.forEach.call(topicSelect.options, function (option) {
        if (option.text.toLowerCase() === wanted.toLowerCase()) topicSelect.value = option.value;
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var name = form.elements.name;
      var message = form.elements.message;
      var location = form.elements.location;
      var invalid = [name, message].filter(function (field) { return !field.value.trim(); });

      [name, message].forEach(function (field) {
        field.setAttribute('aria-invalid', String(invalid.indexOf(field) !== -1));
      });

      if (invalid.length) {
        errorEl.hidden = false;
        invalid[0].focus();
        return;
      }
      errorEl.hidden = true;

      var subject = topicSelect.value + ' - message from ' + name.value.trim();
      var body = message.value.trim();
      if (location.value.trim()) body += '\n\nLocation: ' + location.value.trim();
      body += '\n\n- ' + name.value.trim();

      window.location.href = 'mailto:' + form.getAttribute('data-email') +
        '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
    });
  }

  /* Keep the footer year current ----------------------------------------- */

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
