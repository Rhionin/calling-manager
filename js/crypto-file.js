/* Optional passphrase wrapping for an exported board file. WebCrypto only. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CMCrypto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  var DEFAULT_ITERATIONS = 200000;

  function cryptoObj() {
    return root.crypto || null;
  }

  function canEncrypt() {
    var c = cryptoObj();
    return !!(c && c.subtle && c.getRandomValues);
  }

  function bytesToB64(bytes) {
    var bin = '';
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    var bin = atob(String(b64 || ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function deriveKey(passphrase, salt, iterations, usages) {
    var subtle = cryptoObj().subtle;
    return subtle.importKey('raw', new TextEncoder().encode(String(passphrase)), 'PBKDF2', false, ['deriveKey'])
      .then(function (material) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          usages
        );
      });
  }

  function encryptState(state, passphrase) {
    if (!passphrase || String(passphrase).length < 8) {
      return Promise.reject(new Error('Use a passphrase of at least 8 characters, or export without one.'));
    }
    if (!canEncrypt()) {
      return Promise.reject(new Error('Encryption needs a browser secure context (https or localhost). You can still export a plain JSON file.'));
    }
    var salt = cryptoObj().getRandomValues(new Uint8Array(16));
    var iv = cryptoObj().getRandomValues(new Uint8Array(12));
    return deriveKey(passphrase, salt, DEFAULT_ITERATIONS, ['encrypt']).then(function (key) {
      var plain = new TextEncoder().encode(JSON.stringify(state));
      return cryptoObj().subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
    }).then(function (cipher) {
      return {
        callingManagerExport: 1,
        encrypted: true,
        kdf: 'PBKDF2',
        hash: 'SHA-256',
        iterations: DEFAULT_ITERATIONS,
        salt: bytesToB64(salt),
        iv: bytesToB64(iv),
        ciphertext: bytesToB64(new Uint8Array(cipher))
      };
    });
  }

  function decryptExport(wrapper, passphrase) {
    if (!wrapper || wrapper.encrypted !== true) {
      return Promise.reject(new Error('That file is not an encrypted calling board.'));
    }
    if (!passphrase) return Promise.reject(new Error('Enter the passphrase for this file.'));
    if (!canEncrypt()) {
      return Promise.reject(new Error('This browser cannot decrypt here. Open the page over https or localhost.'));
    }
    var iterations = wrapper.iterations;
    if (typeof iterations !== 'number' || iterations < 10000 || iterations > 1000000) {
      return Promise.reject(new Error('This file asks for an unsupported passphrase setup.'));
    }
    var salt;
    var iv;
    var cipher;
    try {
      salt = b64ToBytes(wrapper.salt);
      iv = b64ToBytes(wrapper.iv);
      cipher = b64ToBytes(wrapper.ciphertext);
    } catch (err) {
      return Promise.reject(new Error('This encrypted file is incomplete.'));
    }
    if (salt.length < 8 || iv.length < 12 || !cipher.length) {
      return Promise.reject(new Error('This encrypted file is incomplete.'));
    }
    return deriveKey(passphrase, salt, iterations, ['decrypt']).then(function (key) {
      return cryptoObj().subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
    }).then(function (plain) {
      return JSON.parse(new TextDecoder().decode(plain));
    }).catch(function (err) {
      if (err && (err.name === 'OperationError' || err.name === 'InvalidAccessError')) {
        throw new Error('That passphrase did not open this file.');
      }
      throw err;
    });
  }

  return {
    canEncrypt: canEncrypt,
    encryptState: encryptState,
    decryptExport: decryptExport,
    iterations: DEFAULT_ITERATIONS
  };
});
