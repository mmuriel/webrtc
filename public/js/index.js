/* Import libraries */
import $ from 'jquery';
import io from 'socket.io-client';
//import kurento = require('kurento/kurento-client-js');


/* Import models */
import WssCommingMessageHandler from './models/WssCommingMessageHandler.js';
import EvClientIdentity from './models/EvClientIdentity.js';
import EvClients from './models/EvClients.js';

/* Import Classes */
import EvClientNickNameSetter from './classes/EvClientNickNameSetter.js';
import EvClientWsConectedHandler from './classes/EvClientWsConectedHandler.js';
import EvClientWsJoinedToRoomHandler from './classes/EvClientWsJoinedToRoomHandler.js';
import EvClientWsNewConnectionHandler from './classes/EvClientWsNewConnectionHandler';
import EvClientWsNewSubscriptionHandler from './classes/EvClientWsNewSubscriptionHandler';
import EvClientWsGetAllClientsHandler from './classes/EvClientWsGetAllClientsHandler'
import EvClientsDrawer from './classes/EvClientsDrawer';
import EvClientCallStatus from './models/EvClientCallStatus';

/* Import Modules */




/**
* New object to handle calling status
*/
const cltCallStatus = new EvClientCallStatus();
cltCallStatus.setStatus('NOTREADY');
/**
* New object to draw the clients list
*/
const cltsDrawer = new EvClientsDrawer();
/**
* It creates the clients object
*/
const evClients = new EvClients();
/**
* It connects to websocket and webrtc signaling server.
*/
//const mainSocket = io('https://192.168.1.6:8443');
const mainSocket = io('https://192.168.1.10:8443');
/**
*	It defines the identity object
*/
const cltIdentity = new EvClientIdentity();
/**
* This is a javascript plain object to 
* pass to kurentoUtils.WebRtcPeer as constructor parameter 
*/

let localVideoDisplay = document.getElementById('vOwn');
let remoteVideoDisplay = document.getElementById('vForeign');
let localStream = {};

const pcConfiguration = {
	
	"iceServers": [{
	   'username': 'ejvturn',
	   'urls': ['turn:turn100.sientifica.com:5349'],
	   'credential': '7235bdM235'
	}],
	//"iceTransportPolicy": "relay"  //stun wont be used
}
/**
* It defines de callee user ID
*/
let calleeId = '';

/*
*
*/
let pc = {};

/**
*	It defines handlers for messages coming from websocket server
*/
const evcltWsOnConnectedHandler = new EvClientWsConectedHandler();
const evCltWsJoinedToRoomHandler = new EvClientWsJoinedToRoomHandler();
const evCltWsNewConnectionHandler = new EvClientWsNewConnectionHandler();
const evCltWsNewSubscriptionHandler = new EvClientWsNewSubscriptionHandler();
const evCltWsGetAllClientsHandler = new EvClientWsGetAllClientsHandler(cltsDrawer);
const wssMsgHandler = new WssCommingMessageHandler(mainSocket);



/*
	Websocket connection related event handlers
*/

wssMsgHandler.subscribeToEvents('connected',evcltWsOnConnectedHandler.onConnected);//Connected to websocket server
wssMsgHandler.subscribeToEvents('joined',evCltWsJoinedToRoomHandler.onJoined);
wssMsgHandler.subscribeToEvents('new subscription',(data)=>{
	evCltWsNewSubscriptionHandler.onNewSubscription(data,mainSocket,cltIdentity);
});
wssMsgHandler.subscribeToEvents('all clients',(data)=>{
	evClients.clients = data.clients;
	evCltWsGetAllClientsHandler.onGetAllClients(evClients);
});


/*
	WebRTC connection related event handlers
*/
wssMsgHandler.subscribeToEvents('rejectedcall',(data)=>{
	let callee = evClients.getClientByUID(data.calleeId);
	alert(`Call request rejected by ${callee.name}`);
	pc = {};
	cltCallStatus.setStatus('READYY');

});
wssMsgHandler.subscribeToEvents('incomingcall',(data)=>{

	if (cltCallStatus.getStatus()!='READY'){

		let fullStatus = cltCallStatus.getFullStatus();
		mainSocket.emit("message",{
			topic: 'rejectedCall',
			info:{
				callerId: data.callerId,
				calleeId: data.calleeId,
				msg: fullStatus.msg
			}
		});
		console.log("Incoming call rejected by busy status");
		return false;
	}

	let caller = evClients.getClientByUID(data.callerId);
	if (!confirm(`User ${caller.name} is calling...`)){

		console.log(err);
		mainSocket.emit("message",{
			topic: 'rejectedCall',
			info:{
				callerId: data.callerId,
				calleeId: data.calleeId,
				msg: 'Call rejected by user'
			}
		});
		return false;

	}
	cltCallStatus.setStatus('BUSY');
	pc = {};
	pc = new RTCPeerConnection(pcConfiguration);
	pc.onicecandidate = (event)=>{
		console.log(event);
	}
	/*
		It captures local media
	*/
	navigator.mediaDevices.getUserMedia({ audio: 1, video: 1 }).then((stream)=>{
		localStream = stream;
		localVideoDisplay.srcObject = localStream;
		localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
		return pc.setRemoteDescription(new RTCSessionDescription(data.sdpOffer));
	}).then(()=>{
		console.log(`Creating the sdp answer...`);
		return pc.createAnswer();
	}).then((sdpAnswer)=>{
		console.log(`Answering ok to calling request...`);
		mainSocket.emit("message",{
			topic: 'callResponse',
			info:{
				callerId: data.callerId,
				calleeId: data.calleeId,
				sdpAnswer: sdpAnswer
			}
		});
	}).catch((err)=>{

		console.log(err);
		mainSocket.emit("message",{
			topic: 'rejectedCall',
			info:{
				callerId: data.callerId,
				calleeId: data.calleeId,
				msg: err
			}
		});
	});


});
wssMsgHandler.subscribeToEvents('callresponser',(data)=>{
});
wssMsgHandler.subscribeToEvents('icecandidate',(data)=>{
})
wssMsgHandler.subscribeToEvents('hangup',(data)=>{
})

/**
* It instantiates an object to handle the prompt for nickname
*/
const evNickSetter = new EvClientNickNameSetter();
/** 
* It delegates any message coming from signaling server to
* WssMessageHandler instance.
*/
mainSocket.on("message",(data)=>{
	wssMsgHandler.onMesage(data);
});
/*

	Code to run after document is ready

*/
$(document).ready(()=>{
	/* 1. Asking user for a nickname */
	 do{
	 	cltIdentity.name = evNickSetter.getNickName();
	 } while (cltIdentity.name == '' || typeof cltIdentity.name == 'undefined' || cltIdentity.name==null)
    /* 2. It registers client in signaling server */
	mainSocket.emit("subscribe",{
		room: 'ev',
		uid: cltIdentity.uid,
		name:cltIdentity.name,
		socketid:mainSocket.id
	});
	cltCallStatus.setStatus('READY');
	/*
	
		Buttons onclick handlers
	
	*/
	const btnStart = document.querySelector("button[class='controls__start']");
	const btnCall = document.querySelector("button[class='controls__call']");
	const btnStop = document.querySelector("button[class='controls__stop']");
	btnStart.addEventListener("click",(e)=>{

		pc = {};
		pc = new RTCPeerConnection(pcConfiguration);
		pc.onicecandidate = (event)=>{
			console.log(event);
		}
		/*
			It captures local media
		*/
		navigator.mediaDevices.getUserMedia({ audio: 1, video: 1 }).then((stream)=>{
			localStream = stream;
			localVideoDisplay.srcObject = localStream;
			localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
		}).catch((err)=>{
			console.log(err);
		});
		
	});
	
	btnCall.addEventListener("click",(e)=>{

		let fullStatus = cltCallStatus.getFullStatus();
		if (fullStatus.status != 'READY'){
			alert (fullStatus.msg);
			return false;
		}

		if (calleeId == ''){
			alert("Please choose a user to call");
			return false;
		}

		let callee = evClients.getClientByUID(calleeId);
		if (!callee){
			alert("Not valid user to call");
			return false;
		}

		/*
			It generates sdp offer
		*/
		if (pc.constructor.name == 'RTCPeerConnection'){

			pc.createOffer().then((rtcOfferObj)=>{

				let wssMsgObj = {
					topic: 'call',
					info: {
						callerId: cltIdentity.uid,
						calleeId: calleeId,
						sdpOffer:rtcOfferObj
					}
				};
				mainSocket.emit("message",wssMsgObj);
				console.log(`Sending to signaling server sdp offer ${wssMsgObj}`);

			}).catch((err)=>{
				console.log(err);
			})
		}
		else{
			alert("Please click on Start button first");
			return false;
		}
		


	});

	btnStop.addEventListener("click",(e)=>{

		localVideoDisplay.srcObject = null;
		localStream = {};
		pc = {};
		
	});
	
});

/*
	Choosing users to call handler
*/
$(".users").on('click',".clientList__client",(e)=>{

	$("ul.clientsList li").removeClass("clientList__client--selected");
	$(e.target).addClass('clientList__client--selected');
	calleeId = $(e.target).attr('data-cltid');
	//console.log(calleeId);
	
})
