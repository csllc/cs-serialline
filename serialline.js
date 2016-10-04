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
var serialPortFactory = require('serialport');

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

  // Use the node-serialport line parser for incoming data
  config.options.parser = serialPortFactory.parsers.readline('\n')

  // The serial port object that is managed by this instance.
  // The port is not opened, just instantiated
  me.port = new serialPortFactory.SerialPort( config.name, config.options, false );

  me.list = serialPortFactory.list;

  me.defaultTimeout = config.timeout || 1000;

  me.verbose = config.verbose || false;

  // Queue for outgoing messages
  me.queue = [];

  // Register Event handler for serial port incoming data
  this.port.on('data', this.onData.bind(this));

  // Function to catch response timeouts
  this.handleResponseTimeout = this.handleResponseTimeout.bind(this);

  
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

    serialPortFactory.list( function(err, ports) {
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
          console.log( 'port disconnected');
        }

        me.emit( 'connected');

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

    me.port.write( me.queue[0].command + '\r\n', function (err)  {
        if( err ) {
          me.queue[0].callback( err );
        }
        else {
          // wait for a response
          me.responseTimer = setTimeout( me.handleResponseTimeout, timeout);

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
 * @private
 * @param {Buffer} data
 */
SerialLine.prototype.onData = function(data)
{
  var me = this;

  if( me.verbose ) {
    console.log('rx', data );
  }
  
  if( me.queue.length > 0 ) {
    var cmd = me.queue[0];

    // accumulate all the matching data received while this command is in process
    if( cmd.options.scan && data.search( cmd.options.scan ) >-1 ) {
      cmd.dataLines.push( data );
    }

    //console.log('comparing ' + data + '\n   with ' + cmd.response );

    // Test to see if the received data matches the expected response
    if( data.search( cmd.response ) > -1) {

      //console.log( '---> MATCH');
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

    this.queue[0].callback( new Error('Timeout') );
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
  this.port.on('open', this.emit.bind(this, 'open'));
  this.port.on('close', this.emit.bind(this, 'close'));
  this.port.on('error', this.emit.bind(this, 'error'));
  this.port.on('data', this.emit.bind(this, 'data'));
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

