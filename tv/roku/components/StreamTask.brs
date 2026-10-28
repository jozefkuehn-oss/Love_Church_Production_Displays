' Asks the display server to start this TV's stream, then waits until the
' first video segments exist (a few seconds) before handing back the address.
sub init()
    m.top.functionName = "go"
end sub

sub go()
    base = m.top.server
    if Right(base, 1) = "/" then base = Left(base, Len(base) - 1)
    q = ""
    if m.top.tv <> invalid and m.top.tv <> "" then q = "?tv=" + m.top.tv
    offline = "Can't reach the display server at " + base + ". Check this TV is on the church network. Retrying…"
    for i = 1 to 20
        http = CreateObject("roUrlTransfer")
        port = CreateObject("roMessagePort")
        http.SetMessagePort(port)
        http.SetUrl(base + "/api/tv/stream" + q)
        http.RetainBodyOnError(true)
        if not http.AsyncGetToString()
            m.top.result = { ok: false, error: offline }
            return
        end if
        msg = wait(8000, port)
        if type(msg) <> "roUrlEvent"
            http.AsyncCancel()
            m.top.result = { ok: false, error: offline }
            return
        end if
        j = ParseJson(msg.GetString())
        if j = invalid
            m.top.result = { ok: false, error: offline }
            return
        end if
        if msg.GetResponseCode() <> 200
            err = offline
            if j.error <> invalid then err = j.error
            m.top.result = { ok: false, error: err }
            return
        end if
        if j.ready <> invalid and j.ready = true
            name = ""
            if j.name <> invalid then name = j.name
            m.top.result = { ok: true, url: base + j.url, name: name }
            return
        end if
        sleep(2000)
    end for
    m.top.result = { ok: false, error: "The stream is taking a while to start. Retrying…" }
end sub
