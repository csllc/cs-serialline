/**
 * Test script for serialline
 *
 * Mocks the node-serialport module to allow hardware-less testing
 *
 */
'use strict';

var mockery = require( 'mockery');

var parsers = require('../node_modules/serialport/lib/parsers');

var util = require( 'util' );
var EventEmitter = require('events').EventEmitter;

// test result checking library
var expect = require('chai').expect;

// test helpers for callbacks
var sinon = require('sinon');


var SerialLine;

function SerialPortMock(path, options, callback) {


  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  options = options || {};

  this.path = path;

  this.fd = null;
  this.paused = true;
  this.opening = false;
  this.closing = false;

  this.readable = true;
  this.reading = false;

  this.options = options;
  this.options.parser = this.options.parser || parsers.raw;

  this.options.disconnectedCallback = this._disconnected.bind(this);
  this.options.dataCallback = this.options.parser.bind(this, this);

  this.loopback = true;

  if (this.options.autoOpen) {
    // is nextTick necessary?
    process.nextTick(this.open.bind(this, callback));
  }
}

util.inherits( SerialPortMock, EventEmitter );


SerialPortMock.prototype._error = function(error, callback) {
  if (callback) {
    callback.call(this, error);
  } else {
    this.emit('error', error);
  }
};

SerialPortMock.prototype.open = function(callback) {
  if (this.isOpen()) {
    return this._error(new Error('Port is already open'), callback);
  }

  if (this.opening) {
    return this._error(new Error('Port is opening'), callback);
  }

  this.readable = true;
  this.reading = false;

  this.fd = 1;
  this.paused = false;
  this.opening = false;

  this.emit('open');

  if (callback) { 
    callback.call(this, null) ;
  }
};

SerialPortMock.prototype.update = function(options, callback) {
  if (!this.isOpen()) {
    return this._error(new Error('Port is not open'), callback);
  }


  if (callback) { callback.call(this, null); }
};

SerialPortMock.prototype.isOpen = function() {
  return this.fd !== null && !this.closing;
};

SerialPortMock.prototype.write = function(buffer, callback) {
  if (!this.isOpen()) {
    return this._error(new Error('Port is not open'), callback);
  }

  if (!Buffer.isBuffer(buffer)) {
    buffer = new Buffer(buffer);
  }

  // write...
  // 
  
  if( this.loopback ) {
    this._emitData( buffer );
  }

  if (callback) { callback.call(this, null); }

};


  SerialPortMock.prototype.mockRx = function( data ) {

    this._emitData(new Buffer(data + '\r\n'));

  };

  SerialPortMock.prototype._read = function( data ) {


  };

  SerialPortMock.prototype._emitData = function(data) {
    
    this.options.dataCallback(data);
  };

  SerialPortMock.prototype.pause = function() {
    this.paused = true;
  };

  SerialPortMock.prototype.resume = function() {
    this.paused = false;

    if (this.buffer) {
      var buffer = this.buffer;
      this.buffer = null;
      this._emitData(buffer);
    }

    // No longer open?
    if (!this.isOpen()) {
      return;
    }

    this._read();
  };

SerialPortMock.prototype._disconnected = function(err) {
  this.paused = true;
  this.emit('disconnect', err);
  if (this.closing) {
    return;
  }

  if (this.fd === null) {
    return;
  }

  this.closing = true;
  if (process.platform !== 'win32') {
    this.readable = false;
  }

  this.closing = false;
  this.fd = null;
  this.emit('close');

};

SerialPortMock.prototype.close = function(callback) {
  this.paused = true;

  if (this.closing) {
    return this._error(new Error('Port is not open'), callback);
  }

  if (!this.isOpen()) {
    return this._error(new Error('Port is not open'), callback);
  }

  this.closing = true;

  // Stop polling before closing the port.
  if (process.platform !== 'win32') {
    this.readable = false;
  }

  this.closing = false;

  this.fd = null;
  this.emit('close');
  if (callback) { callback.call(this, null); }

};

SerialPortMock.prototype.flush = function(callback) {
  if (!this.isOpen()) {
    return this._error(new Error('Port is not open'), callback);
  }

  if (callback) { callback.call(this, null); }
};

SerialPortMock.prototype.set = function(options, callback) {

  if (!this.isOpen()) {
    return this._error(new Error('Port is not open'), callback);
  }

  options = options || {};
  if (!callback && typeof options === 'function') {
    callback = options;
    options = {};
  }

  if (callback) { callback.call(this, null); }
};

SerialPortMock.prototype.drain = function(callback) {
  if (!this.isOpen()) {
    return this._error(new Error('Port is not open'), callback);
  }

  if (callback) { callback.call(this, null); }
};

SerialPortMock.list = function() {
  return [];
};

SerialPortMock.parsers = parsers;

/**
 * Runs before any tests in this file
 *
 */
before(function(done) {

  mockery.enable({ warnOnUnregistered: false} );
  
  mockery.registerMock( 'serialport', SerialPortMock );
  mockery.registerAllowable(['../serialline', 'util', 'events', 'bluebird'], true);
  
  SerialLine = require('../serialline');

  done();

});

/**
 * Runs after any tests in this file
 *
 */
after(function() {

  mockery.deregisterAll();

  // runs after all tests in this block
  mockery.disable();
});


describe('Serialline', function() {

  it('should send a string with no response', function(done) {

    var port = new SerialLine();

    port.open()
    .then( function() { return port.send('Hello?'); })

    .then( function( result ) { 
      //console.log( 'res: ' , result);
      //expect( result );
      done(); 
    })
    .catch( function( err ) {
      done( err );
    });
    
  });

  it('should detect an echoed string', function(done) {

    var port = new SerialLine();

    port.open()
    .then( function() { return port.send('Is there anybody in there?', '^Is there anybody in there?'); })

    .then( function() { done(); })
    .catch( function( err ) {
      done( err );
    });
    
  });

  it('watch for single instance', function(done) {

    var port = new SerialLine();

    port.watch( '^J', function( capture ) {
      expect( capture ).to.equal('J');

      done();
    });

    port.open()
    .then( function() { 
      return port.send('Just nod if you can hear me.' );
    })

    .catch( function( err ) {
      done( err );
    });
    
  });

  it('watch multiple matches in one line', function(done) {

    var port = new SerialLine();

    var callback = sinon.spy();

    var regexp = /[A-E]/gi;
    port.watch( regexp, callback );

    port.open()
    .then( function() { 
      return port.send('Is there anyone at home?' );
    })
    .then( function() { 

      expect(callback.callCount).to.equal(6);
      expect(callback.getCall(0).args[0]).to.equal('e');
      expect(callback.getCall(2).args[0]).to.equal('a');
      expect(callback.getCall(3).args[0]).to.equal('e');

      done();
    })

    .catch( function( err ) {
      done( err );
    });
    
  });

  it('watch multiple matches while waiting for response', function(done) {

    var port = new SerialLine();

    var callback = sinon.spy();

    var regexp = /[aeiou]/g;
    port.watch( regexp, callback );

    port.open()
    .then( function() { 
      return port.send('Come on, now,', 'now' );
    })
    .then( function( resp ) { 
      expect( resp ).to.equal( 'Come on, now,\r');

      expect(callback.callCount).to.equal(4);
      expect(callback.getCall(0).args[0]).to.equal('o');
      expect(callback.getCall(3).args[0]).to.equal('o');

      done();
    })

    .catch( function( err ) {
      done( err );
    });
    
  });

  it('match lines on unsolicited data', function(done) {

    var port = new SerialLine();

    var callback = sinon.spy();

    var regexp = /I/g;
    port.watch( regexp, callback );

    port.open()
    .then( function() { 
      port.port.mockRx( 'I hear you\'re feeling down.' );
    })
    .delay(100)   // let the receive processing work
    .then( function() { 

      expect(callback.callCount).to.equal(1);
      expect(callback.getCall(0).args[0]).to.equal('I');

      done();
    })

    .catch( function( err ) {
      done( err );
    });
    
  });

  it('match lines on unsolicited data', function(done) {

    var port = new SerialLine();

    var callback = sinon.spy();

    var regexp = /%(.*?)%/g;
    port.watch( regexp, callback );

    port.open()
    .then( function() { 
      port.port.mockRx( 'Well I can ease your %pain%' );
    })
    .delay(100)   // let the receive processing work
    .then( function() { 

      expect(callback.callCount).to.equal(1);
      expect(callback.getCall(0).args[0]).to.equal('%pain%');

      done();
    })

    .catch( function( err ) {
      done( err );
    });
    
  });

});
