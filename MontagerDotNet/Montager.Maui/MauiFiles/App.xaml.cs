using Microsoft.Maui.Controls;

namespace Montager.Maui;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();
        MainPage = new MainPage();
    }
}
