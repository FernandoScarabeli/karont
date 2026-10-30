#!/usr/bin/python3
"""Local freedesktop service fixture: no terminal/project content is accepted."""
import dbus, dbus.service, dbus.mainloop.glib
import ctypes
import json, sys

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
name = dbus.service.BusName('org.freedesktop.Notifications', bus)
class Notifications(dbus.service.Object):
    def __init__(self):
        super().__init__(bus, '/org/freedesktop/Notifications')
        self.count = 0
    @dbus.service.method('org.freedesktop.Notifications', in_signature='', out_signature='as')
    def GetCapabilities(self):
        return ['body', 'actions']
    @dbus.service.method('org.freedesktop.Notifications', in_signature='', out_signature='ssss')
    def GetServerInformation(self):
        return ('karont-test', 'karont', '1.0', '1.2')
    @dbus.service.method('org.freedesktop.Notifications', in_signature='susssasa{sv}i', out_signature='u')
    def Notify(self, app, replaces, icon, summary, body, actions, hints, timeout):
        assert str(app) == 'karont', 'unexpected application identity'
        self.count += 1
        allowed = ['Execução concluída','Execução com erro','Rollback concluído','Rollback falhou','Conexão com daemon interrompida','Daemon indisponível','Recuperação necessária','Execução retomada em nova sessão','Limite temporário confirmado','Auto Resume agendado','Execução retomada','Retomada falhou']
        assert str(summary) in allowed, 'private or unexpected title'
        assert str(body) == 'Abra o Karont para consultar os detalhes.', 'private or unexpected body'
        with open(sys.argv[1], 'a') as output:
            output.write(json.dumps({'id': self.count, 'title':str(summary), 'bodySafe':True})+'\n')
        return self.count
    @dbus.service.method('org.freedesktop.Notifications', in_signature='u', out_signature='')
    def CloseNotification(self, id):
        pass
service = Notifications()
print('READY', flush=True)
glib = ctypes.CDLL('libglib-2.0.so.0')
glib.g_main_loop_new.argtypes = [ctypes.c_void_p, ctypes.c_int]
glib.g_main_loop_new.restype = ctypes.c_void_p
glib.g_main_loop_run.argtypes = [ctypes.c_void_p]
glib.g_main_loop_run(glib.g_main_loop_new(None, False))
