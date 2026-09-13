import { useEffect, useRef, useState } from "react";

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";

import { db } from "./firebase";

export default function CallWindow({
  callId,
  caller,
  receiver,
  isCaller,
  type,
  onEnd,
}) {
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const remoteAudio = useRef(null);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);

  const pendingCandidates = useRef([]);

  // Prevent cleanup / onEnd from happening multiple times
  const endedRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState("");

  // =====================================================
  // COMPLETE CLEANUP
  // =====================================================

  const cleanupCall = () => {
    console.log("Cleaning call resources...");

    // ---------------------------------
    // STOP CAMERA + MICROPHONE
    // ---------------------------------

    if (localStreamRef.current) {
      const tracks =
        localStreamRef.current.getTracks();

      tracks.forEach((track) => {
        try {
          track.enabled = false;
          track.stop();
        } catch (err) {
          console.error(
            "Track stop error:",
            err
          );
        }
      });

      localStreamRef.current = null;
    }

    // ---------------------------------
    // CLEAR VIDEO ELEMENTS
    // ---------------------------------

    if (localVideo.current) {
      localVideo.current.pause();
      localVideo.current.srcObject = null;
    }

    if (remoteVideo.current) {
      remoteVideo.current.pause();
      remoteVideo.current.srcObject = null;
    }

    // ---------------------------------
    // CLEAR AUDIO
    // ---------------------------------

    if (remoteAudio.current) {
      remoteAudio.current.pause();
      remoteAudio.current.srcObject = null;
    }

    // ---------------------------------
    // CLOSE PEER CONNECTION
    // ---------------------------------

    if (peerRef.current) {
      try {
        peerRef.current.ontrack = null;
        peerRef.current.onicecandidate = null;
        peerRef.current.onconnectionstatechange =
          null;

        peerRef.current.close();
      } catch (err) {
        console.error(
          "Peer close error:",
          err
        );
      }

      peerRef.current = null;
    }

    pendingCandidates.current = [];

    setConnected(false);
    setMuted(false);
    setCameraOff(false);
  };

  // =====================================================
  // END CALL LOCALLY
  // =====================================================

  const finishCall = async () => {
    if (endedRef.current) return;

    endedRef.current = true;

    console.log("Ending call...");

    // FIRST stop camera/mic immediately
    cleanupCall();

    // THEN update Firebase
    try {
      await updateDoc(
        doc(db, "calls", callId),
        {
          status: "ended",
        }
      );
    } catch (err) {
      console.error(
        "Call status update error:",
        err
      );
    }

    // Close UI
    onEnd();
  };

  // =====================================================
  // START CALL
  // =====================================================

  useEffect(() => {
    let unsubscribeCall = null;
    let unsubscribeCandidates = null;

    let cancelled = false;

    const start = async () => {
      try {
        // ---------------------------------
        // CHECK MEDIA SUPPORT
        // ---------------------------------

        if (
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error(
            "Camera/Microphone browser mein available nahi hai. HTTPS ya localhost use karo."
          );
        }

        // ---------------------------------
        // CAMERA + MICROPHONE
        // ---------------------------------

        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: true,
              video: type === "video",
            }
          );

        if (cancelled) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          return;
        }

        localStreamRef.current = stream;

        // Local video
        if (localVideo.current) {
          localVideo.current.srcObject =
            stream;
        }

        // ---------------------------------
        // PEER CONNECTION
        // ---------------------------------

        const peer =
          new RTCPeerConnection({
            iceServers: [
              {
                urls:
                  "stun:stun.l.google.com:19302",
              },
              {
                urls:
                  "stun:stun1.l.google.com:19302",
              },
            ],
          });

        peerRef.current = peer;

        // ---------------------------------
        // ADD LOCAL TRACKS
        // ---------------------------------

        stream
          .getTracks()
          .forEach((track) => {
            peer.addTrack(
              track,
              stream
            );
          });

        // ---------------------------------
        // CONNECTION STATE
        // ---------------------------------

        peer.onconnectionstatechange = () => {
          console.log(
            "Connection:",
            peer.connectionState
          );

          if (
            peer.connectionState ===
            "connected"
          ) {
            setConnected(true);
          }

          if (
            peer.connectionState ===
            "failed"
          ) {
            setError(
              "Connection failed. Internet connection check karo."
            );
          }
        };

        // ---------------------------------
        // REMOTE STREAM
        // ---------------------------------

        peer.ontrack = (event) => {
          const remoteStream =
            event.streams[0];

          if (!remoteStream) return;

          // Video
          if (
            type === "video" &&
            remoteVideo.current
          ) {
            remoteVideo.current.srcObject =
              remoteStream;

            remoteVideo.current
              .play()
              .catch(() => {});
          }

          // Audio
          if (remoteAudio.current) {
            remoteAudio.current.srcObject =
              remoteStream;

            remoteAudio.current
              .play()
              .catch(() => {});
          }

          setConnected(true);
        };

        // ---------------------------------
        // FIRESTORE
        // ---------------------------------

        const callRef = doc(
          db,
          "calls",
          callId
        );

        const callerCandidates =
          collection(
            callRef,
            "callerCandidates"
          );

        const receiverCandidates =
          collection(
            callRef,
            "receiverCandidates"
          );

        // ---------------------------------
        // ICE CANDIDATES
        // ---------------------------------

        peer.onicecandidate =
          async (event) => {
            if (
              !event.candidate ||
              endedRef.current
            ) {
              return;
            }

            const targetCollection =
              isCaller
                ? callerCandidates
                : receiverCandidates;

            try {
              await addDoc(
                targetCollection,
                event.candidate.toJSON()
              );
            } catch (err) {
              console.error(
                "ICE error:",
                err
              );
            }
          };

        // ---------------------------------
        // PENDING ICE
        // ---------------------------------

        const addPendingCandidates =
          async () => {
            if (
              !peer.remoteDescription
            ) {
              return;
            }

            const candidates =
              pendingCandidates.current;

            pendingCandidates.current =
              [];

            for (const candidate of candidates) {
              try {
                await peer.addIceCandidate(
                  candidate
                );
              } catch (err) {
                console.error(
                  "Pending ICE error:",
                  err
                );
              }
            }
          };

        // =================================================
        // CALLER
        // =================================================

        if (isCaller) {
          // Create offer
          const offer =
            await peer.createOffer();

          await peer.setLocalDescription(
            offer
          );

          await updateDoc(
            callRef,
            {
              offer: {
                type: offer.type,
                sdp: offer.sdp,
              },
              status: "ringing",
            }
          );

          // ---------------------------------
          // CALL LISTENER
          // ---------------------------------

          unsubscribeCall =
            onSnapshot(
              callRef,
              async (snapshot) => {
                if (endedRef.current)
                  return;

                const data =
                  snapshot.data();

                if (!data) return;

                // Receiver rejected
                if (
                  data.status ===
                  "rejected"
                ) {
                  endedRef.current =
                    true;

                  cleanupCall();
                  onEnd();

                  return;
                }

                // Receiver ended
                if (
                  data.status ===
                  "ended"
                ) {
                  endedRef.current =
                    true;

                  cleanupCall();
                  onEnd();

                  return;
                }

                // Answer received
                if (
                  data.answer &&
                  !peer.remoteDescription
                ) {
                  try {
                    await peer.setRemoteDescription(
                      new RTCSessionDescription(
                        data.answer
                      )
                    );

                    await addPendingCandidates();
                  } catch (err) {
                    console.error(
                      "Answer error:",
                      err
                    );
                  }
                }
              }
            );

          // ---------------------------------
          // RECEIVER ICE
          // ---------------------------------

          unsubscribeCandidates =
            onSnapshot(
              receiverCandidates,
              (snapshot) => {
                snapshot
                  .docChanges()
                  .forEach(
                    async (change) => {
                      if (
                        change.type !==
                        "added"
                      ) {
                        return;
                      }

                      const candidate =
                        new RTCIceCandidate(
                          change.doc.data()
                        );

                      if (
                        peer.remoteDescription
                      ) {
                        try {
                          await peer.addIceCandidate(
                            candidate
                          );
                        } catch (err) {
                          console.error(
                            "ICE add error:",
                            err
                          );
                        }
                      } else {
                        pendingCandidates.current.push(
                          candidate
                        );
                      }
                    }
                  );
              }
            );
        }

        // =================================================
        // RECEIVER
        // =================================================

        else {
          // ---------------------------------
          // CALL LISTENER
          // ---------------------------------

          unsubscribeCall =
            onSnapshot(
              callRef,
              async (snapshot) => {
                if (endedRef.current)
                  return;

                const data =
                  snapshot.data();

                if (!data) return;

                // Caller ended
                if (
                  data.status ===
                  "ended"
                ) {
                  endedRef.current =
                    true;

                  cleanupCall();
                  onEnd();

                  return;
                }

                // Caller rejected / cancelled
                if (
                  data.status ===
                  "rejected"
                ) {
                  endedRef.current =
                    true;

                  cleanupCall();
                  onEnd();

                  return;
                }

                // ---------------------------------
                // OFFER
                // ---------------------------------

                if (
                  data.offer &&
                  !peer.remoteDescription
                ) {
                  try {
                    await peer.setRemoteDescription(
                      new RTCSessionDescription(
                        data.offer
                      )
                    );

                    await addPendingCandidates();

                    // Create answer
                    const answer =
                      await peer.createAnswer();

                    await peer.setLocalDescription(
                      answer
                    );

                    await updateDoc(
                      callRef,
                      {
                        answer: {
                          type:
                            answer.type,
                          sdp:
                            answer.sdp,
                        },
                        status:
                          "connected",
                      }
                    );
                  } catch (err) {
                    console.error(
                      "Answer creation error:",
                      err
                    );
                  }
                }
              }
            );

          // ---------------------------------
          // CALLER ICE
          // ---------------------------------

          unsubscribeCandidates =
            onSnapshot(
              callerCandidates,
              (snapshot) => {
                snapshot
                  .docChanges()
                  .forEach(
                    async (change) => {
                      if (
                        change.type !==
                        "added"
                      ) {
                        return;
                      }

                      const candidate =
                        new RTCIceCandidate(
                          change.doc.data()
                        );

                      if (
                        peer.remoteDescription
                      ) {
                        try {
                          await peer.addIceCandidate(
                            candidate
                          );
                        } catch (err) {
                          console.error(
                            "ICE add error:",
                            err
                          );
                        }
                      } else {
                        pendingCandidates.current.push(
                          candidate
                        );
                      }
                    }
                  );
              }
            );
        }
      } catch (err) {
        console.error(
          "CALL ERROR:",
          err
        );

        if (!cancelled) {
          setError(
            err?.message ||
              "Camera/Microphone access failed."
          );
        }
      }
    };

    start();

    // =================================================
    // COMPONENT CLEANUP
    // =================================================

    return () => {
      cancelled = true;

      unsubscribeCall?.();
      unsubscribeCandidates?.();

      // IMPORTANT:
      // Camera + microphone always stop here
      cleanupCall();
    };
  }, [
    callId,
    isCaller,
    type,
    onEnd,
  ]);

  // =====================================================
  // MUTE
  // =====================================================

  const toggleMute = () => {
    const stream =
      localStreamRef.current;

    if (!stream) return;

    const audioTrack =
      stream.getAudioTracks()[0];

    if (!audioTrack) return;

    audioTrack.enabled =
      !audioTrack.enabled;

    setMuted(
      !audioTrack.enabled
    );
  };

  // =====================================================
  // CAMERA
  // =====================================================

  const toggleCamera = () => {
    const stream =
      localStreamRef.current;

    if (!stream) return;

    const videoTrack =
      stream.getVideoTracks()[0];

    if (!videoTrack) return;

    videoTrack.enabled =
      !videoTrack.enabled;

    setCameraOff(
      !videoTrack.enabled
    );
  };

  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="call-overlay">
      <div className="call-window">

        {/* TOP BAR */}

        <div className="call-top">
          <div>
            <strong>
              {type === "video"
                ? "🎥 Video Call"
                : "📞 Audio Call"}
            </strong>

            <span>
              {error
                ? "Connection problem"
                : connected
                ? "🟢 Connected"
                : "🔵 Connecting..."}
            </span>
          </div>

          {/* TOP CLOSE */}

          <button
            className="call-close"
            onClick={finishCall}
            title="End Call"
          >
            ✕
          </button>
        </div>

        {/* ERROR */}

        {error && (
          <div className="call-error">
            {error}
            <br />
            Camera/microphone permission
            check karo.
          </div>
        )}

        {/* VIDEO CALL */}

        {type === "video" ? (
          <div className="video-area">

            <video
              ref={remoteVideo}
              autoPlay
              playsInline
              className="remote-video"
            />

            <video
              ref={localVideo}
              autoPlay
              playsInline
              muted
              className="local-video"
            />

            {!connected && (
              <div className="video-status">
                📞 Calling...
              </div>
            )}

          </div>
        ) : (
          /* AUDIO CALL */

          <div className="audio-call">

            <div className="big-heart">
              ❤️
            </div>

            <h2>
              {connected
                ? "Connected"
                : "Calling..."}
            </h2>

            <p>
              {connected
                ? "Audio call connected"
                : "Waiting for answer..."}
            </p>
            </div>
        )}

        {/* HIDDEN REMOTE AUDIO */}

        <audio
          ref={remoteAudio}
          autoPlay
          playsInline
          className="remote-audio"
        />

        {/* CALL CONTROLS */}

        <div className="call-controls">

          {/* MUTE */}

          <button
            onClick={toggleMute}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "🎙️"}
          </button>

          {/* CAMERA */}

          {type === "video" && (
            <button
              onClick={toggleCamera}
              title={
                cameraOff
                  ? "Turn camera on"
                  : "Turn camera off"
              }
            >
              {cameraOff ? "🚫" : "🎥"}
            </button>
          )}

          {/* END CALL */}

          <button
            className="end-call"
            onClick={finishCall}
            title="End Call"
          >
            ☎
          </button>

        </div>

      </div>
    </div>
  );
}