sub init()
    m.video = m.top.findNode("video")
    m.status = m.top.findNode("status")
    m.exitBox = m.top.findNode("exitBox")
    m.retry = m.top.findNode("retry")
    m.exitTimer = m.top.findNode("exitTimer")
    m.video.observeField("state", "onVideoState")
    m.retry.observeField("fire", "start")
    m.exitTimer.observeField("fire", "hideExit")
    m.status.text = "Connecting to the display server…"
    m.top.setFocus(true)
end sub

sub onConfig()
    start()
end sub

sub start()
    if m.top.server = invalid or m.top.server = ""
        m.status.text = "No display server address. Rebuild this app with the Mac's address (tv/roku/build.sh)."
        return
    end if
    m.task = CreateObject("roSGNode", "StreamTask")
    m.task.server = m.top.server
    m.task.tv = m.top.tv
    m.task.observeField("result", "onResult")
    m.task.control = "run"
end sub

sub onResult()
    r = m.task.result
    if r = invalid then return
    if r.ok = true
        content = CreateObject("roSGNode", "ContentNode")
        content.url = r.url
        content.streamFormat = "hls"
        content.live = true
        content.title = r.name
        m.video.content = content
        m.video.control = "play"
    else
        m.status.text = r.error
        m.retry.control = "start"
    end if
end sub

sub onVideoState()
    s = m.video.state
    if s = "playing"
        m.status.text = ""
    else if s = "error" or s = "finished"
        m.video.control = "stop"
        m.status.text = "Reconnecting…"
        m.retry.control = "start"
    end if
end sub

sub hideExit()
    m.exitBox.visible = false
end sub

' Back once shows "Leave the dashboard?"; Back again exits the app.
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "back"
        if m.exitBox.visible then return false
        m.exitBox.visible = true
        m.exitTimer.control = "start"
        return true
    end if
    if m.exitBox.visible
        m.exitBox.visible = false
        return true
    end if
    return false
end function
