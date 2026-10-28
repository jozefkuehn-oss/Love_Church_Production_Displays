' Love Church Production Displays: Roku TV app.
' Plays the dashboard as a live video stream made by the display server.
' The server can pass tv=<id> and server=<address> when it launches the app.
sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("MainScene")
    screen.Show()

    server = CreateObject("roAppInfo").GetValue("server")
    tv = ""
    if args <> invalid
        if args.server <> invalid and args.server <> "" then server = args.server
        if args.tv <> invalid then tv = args.tv
    end if
    scene.tv = tv
    scene.server = server

    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent" and msg.IsScreenClosed() then return
    end while
end sub
