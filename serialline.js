/**
 * NodeJS module to handle a serial port in 'ascii line' mode.
 *
 * This file provides an interface to a serial port, and allows
 * sending of ascii-based commands 
 *
 *
 */

'use strict';


// built-in node utility module
var util = require('util');

// Node event emitter module
var EventEmitter = require('events').EventEmitter;

// Module which manages the serial port
var SerialPortFactory = require('serialport');

// Promise library
var Promise = require('bluebird');


/**
 * Constructor: initializes the object and declares its public interface
 *
 * All config options supported by the node-serialport library may be 
 * passed via the config object.

 * @param object config: optional object containing configuration parameters:
 * @param number config.timeout default timeout (ms) to wait for command response
 * @param number config.baudrate the speed of the serial port
 */
function SerialLine ( config ) {
  var me = this;

  // for debugging
  Promise.longStackTraces();

  // keep track of reconnection timers
  me.reconnectTimer = null;

  // Timer to wait for response from device
  me.responseTimer = null;

  // If config is a string, assume it is the name of the port
  if( 'string' === typeof( config )) {
    config = {
      name: config,
      options: {}
    };
  }

  config = config || {};
  config.options = config.options || {};

  // Use the node-serialport line parser for incoming data
  config.options.parser = config.options.parser || SerialPortFactory.parsers.readline('\n');

  config.options.autoOpen = false;

  // The serial port object that is managed by this instance.
  // The port is not opened, just instantiated
  me.port = new SerialPortFactory( config.name, config.options );

  me.list = SerialPortFactory.list;

  me.defaultTimeout = config.timeout || 1000;

  me.verbose = config.verbose || false;

  me.sendEol = config.sendEol || '\r\n';

  // Queue for outgoing messages
  me.queue = [];

  // Set of watchers for incoming data
  me.watchers = [];

  // Function to catch response timeouts
  this.handleResponseTimeout = this.handleResponseTimeout.bind(this);

  this.setUpSerialPort();

}

// This object can emit events.  Note, the inherits
// call needs to be before .prototype. additions for some reason
util.inherits(SerialLine, EventEmitter);


/**
 * List available ports
 *
 * @returns {object} promise
 */
SerialLine.prototype.listPorts = function() {

  return new Promise(function(resolve, reject){

    SerialPortFactory.list( function(err, ports) {
      if( err ) {
        reject( err );
      }
      else {
        resolve(ports);
      }

    });
  });
};


/**
 * Open the serial port.
 *
 * @returns {object} promise
 */
SerialLine.prototype.open = function() {
  var me = this;

  return new Promise(function(resolve, reject){

    me.port.open( function(error) {
      if( error ) {
        reject( error );
      }
      else {
        if( me.verbose ) {
          console.log( 'port open');
        }

        resolve();
      }

    });
  });
};

/**
 * @returns {boolean}
 */
SerialLine.prototype.isOpen = function()
{
  // That's how SerialPort.write() checks whether the port is open.
  // There's no dedicated public method.
  return !!this.port.fd;
};



SerialLine.prototype.sendNextCommand = function() {

  var me = this;

  if( me.queue.length > 0 ) {

    if( me.verbose ) {
      console.log( 'tx: ' + me.queue[0].command );
    }

    var timeout = me.queue[0].options.timeout || me.defaultTimeout;
    var eol = me.queue[0].options.eol || me.sendEol;

    // Emit what is being sent (probably mostly for diagnostics)
    me.emit( 'write', me.queue[0].command + eol );


    me.port.write( me.queue[0].command + eol, function (err)  {
        if( err ) {
          me.queue[0].callback( err );
          me.queue.shift();
          setImmediate( me.sendNextCommand() );

        }
        else {

          //if( me.queue[0].response ) {
            // wait for a response
            me.responseTimer = setTimeout( me.handleResponseTimeout, timeout);
          //}
          //else {
          //  me.queue[0].callback( null, null );
          //  me.queue.shift();
          //  setImmediate( me.sendNextCommand.bind(me) );
          //}

        }

      });
  }
};

/**
 * Send a command line to the serial port
 * 
 * Returns a promise that resolves when the line has been written to the port
 * and the expected response received, or a timeout occurs
 * 
 * @param string command the string to send, less the CR/LF
 * @param string response a REGEX to scan for the command completeion
 * @param object options :
 * @param number options.timeout time to wait for response (in ms)
 * @param string options.scan REGEX to collect data before the command completion 
 * @returns {object} promise
 */
SerialLine.prototype.send = function( command, response, options ) {
  var me = this;

  if( 'object' === typeof( response )) {
    options = response;
    response = null;
  }

  options = options || {};

  return new Promise(function(resolve, reject){

    me.queue.push( {
      command: command,
      response: response,
      options: options,
      dataLines: [],
      callback: function(err, data ) {
        if( err ) {
          reject( err );
        }
        else {
          resolve( data );
        }
      }
    });

    if( me.queue.length === 1 ) {
      // try to start the command
      me.sendNextCommand();
    }

  });
};

/**
 * Writes directly to the serial port with no queuing or response processing
 * 
 * @param  {[type]} command  [description]
 * @param  {[type]} response [description]
 * @param  {[type]} options  [description]
 * @return {[type]}          [description]
 */
SerialLine.prototype.write = function( command ) {
  var me = this;

  return new Promise(function(resolve, reject){

    // Emit what is being sent (probably mostly for diagnostics)
    me.emit( 'write', command );

    me.port.write( command, function (err)  {
      if( err ) {
        reject(err);

      }
      else {
        resolve();
      }
    });

  });
};


SerialLine.prototype.watch = function( regex, options, callback ) {

  // adjust for options being omitted from the function call
  if( 'function' === typeof( options )) {
    callback = options;
    options = {};
  }

  if( 'function' !== typeof( callback )) {
    throw new Error( 'watch callback must be a function');
  }

  this.watchers.push( { regex: regex, callback: callback });
};

/**
 * @private
 * @param {Buffer} data
 */
SerialLine.prototype.onData = function(data)
{
  var me = this;

  if( me.verbose ) {
    console.log('rx: ', data );
  }
  
  // process the watchers
  me.watchers.forEach( function( watcher ) {

    var matches = data.match( watcher.regex );
    
    //console.log( matches );
    
    if( matches ) {
      matches.forEach( function( match ) {
        watcher.callback( match, watcher.regex );
      });
    }
  });

  if( me.queue.length > 0 ) {
    var cmd = me.queue[0];

    // accumulate all the matching data received while this command is in process
    if( cmd.options.scan && data.search( cmd.options.scan ) >-1 ) {
      cmd.dataLines.push( data );
    }

    // Test to see if the received data matches the expected response
    if( data.search( cmd.response ) > -1) {

      // Cancel the no-response timeout because we have a response
      if( this.responseTimer !== null ) {
        clearTimeout(this.responseTimer);
        this.responseTimer = null;
      }

      // Signal the caller with the response data
      if( cmd.options.scan ) {
        cmd.callback( null, cmd.dataLines );
      }
      else {
        // only return the line that triggered the command completion
        cmd.callback( null, data );
      }

      // Remove the request from the queue
      me.queue.shift();

      // Send the next command if any
      this.sendNextCommand();
    }

  }
  else {
    // we are not processing a command, so just emit upstream
    me.emit( 'data', data );
  }


};

/**
 * @private
 */
SerialLine.prototype.handleResponseTimeout = function()
{
  if( this.responseTimer && this.queue.length > 0) {
    // the command at the top of the queue timed out
    // If we needed a response, raise the error
    if( this.queue[0].response ) {
      this.queue[0].callback( new Error('Timeout') );
    }
    else {
      this.queue[0].callback();
    }
    this.queue.shift();
    this.sendNextCommand();
  }

  this.responseTimer = null;

};


/**
 * Bind event handlers
 *
 * These pass through events from the serial port to our client
 * 
 * @param {serialport.SerialPort} serialPort
 * @returns {serialport.SerialPort}
 */
SerialLine.prototype.setUpSerialPort = function()
{
  var me = this;

  this.port.on('open', this.emit.bind(this, 'open'));
  this.port.on('close', this.emit.bind(this, 'close'));
  this.port.on('error', this.emit.bind(this, 'error'));

  // Register Event handler for serial port incoming data
  this.port.on('data', this.onData.bind(this));


//  this.port.on('data', this.emit.bind(this, 'data'));
  this.port.on('event', this.emit.bind(this, 'event'));

  // Catch an event if the port gets disconnected
  me.port.on( 'disconnected', function() {

    // FYI - the port object drops all listeners when it disconnects
    // but after the disconnected event, so they haven't been dropped at
    // this point.
    if( me.verbose ) {
      console.log( 'port disconnected');
    }

    me.emit( 'disconnected');

    // let the port finish disconnecting, then work on reconnecting
    process.nextTick( function() { me.reconnect(); } );

  });

};


/**
 * Attempt to reopen the port
 *
 */
SerialLine.prototype.reconnect = function() {

  var me = this;

  // re-attach event hooks for the serial port
  me.setUpSerialPort();

  me.reconnectTimer = setInterval( function() {
   me.open()
    .then( function () {
      clearInterval( me.reconnectTimer );
      me.reconnectTimer = null;
    })
    .catch(function(e) {});
  }, 1000 );
};

/**
 * Converts a 16-bit short address into a string like 'A1B2'
 * @param  {Buffer} buffer buffer containing the bytes to format
 * @param  {number} offset offset into the buffer to start reading
 * @return {string}        a string containing the 16-bit hex value
 */
SerialLine.prototype.destroy = function() {

  this.removeAllListeners();

  if (this.port !== null)
  {
    this.port.removeAllListeners();
    this.port.close();
    this.port = null;
  }

};



/**
 * Public interface to this module
 *
 * The object constructor is available to our client
 *
 * @ignore
 */
module.exports = SerialLine;

