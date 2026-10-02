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

  /* Highlight the nav link for the section in view ----------------------- */

  var navLinks = document.querySelectorAll('.site-nav ul a[href^="#"]');
  var sections = Array.prototype.map.call(navLinks, function (link) {
    return document.querySelector(link.getAttribute('href'));
  }).filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(function (section) { navObserver.observe(section); });
  }

  /* Contact form: compose an email in the visitor's mail app ------------- */

  var form = document.getElementById('contact-form');

  if (form) {
    var topicSelect = form.querySelector('[name="topic"]');
    var errorEl = document.getElementById('cf-error');

    // Links like "Report a case" pre-select the matching topic.
    document.querySelectorAll('[data-topic]').forEach(function (link) {
      link.addEventListener('click', function () {
        var topic = link.getAttribute('data-topic');
        Array.prototype.forEach.call(topicSelect.options, function (option) {
          if (option.text === topic) topicSelect.value = option.value;
        });
      });
    });

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
